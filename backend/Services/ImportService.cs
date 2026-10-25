using System.IO.Compression;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend.Data;

namespace MrGoose.Backend.Services;

public record ImportResult(int Prompts, int Submissions, int ModelsUpdated, int BreaksSet, List<string> Notes);

/// <summary>Imports Gray Swan artifacts: the arena export ZIP (→ prompts + submissions) and a chat
/// page-source paste (→ refresh model field-breaks + the break matrix from modelMap). Reference
/// format in reference/GROUND-TRUTH.md §5.</summary>
public class ImportService(MrGooseDb db)
{
    private static readonly JsonSerializerOptions J = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Parse an arena export ZIP (manifest.json + submission-*.json).</summary>
    public async Task<ImportResult> ImportExportZipAsync(Stream zipStream)
    {
        var notes = new List<string>();
        int prompts = 0, subs = 0;
        using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read);

        var existing = db.Submissions.Select(s => s.ExternalId).ToHashSet();

        foreach (var entry in archive.Entries)
        {
            if (!entry.Name.StartsWith("submission", StringComparison.OrdinalIgnoreCase) ||
                !entry.Name.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) continue;

            using var sr = new StreamReader(entry.Open());
            var json = await sr.ReadToEndAsync();
            JsonElement root;
            try { root = JsonDocument.Parse(json).RootElement; }
            catch { notes.Add($"skip {entry.Name}: bad JSON"); continue; }

            var extId = Str(root, "submissionId");
            if (string.IsNullOrEmpty(extId) || existing.Contains(extId)) continue;

            var scenarioRaw = Str(root, "scenario");               // "WB2S5 - Exfiltrate…"
            var code = scenarioRaw.Split(' ', 2)[0].Trim();
            var payload = Str(root, "title");                        // injection payload preview
            var model = Str(root, "model");
            var status = Str(root, "status");
            var isBreak = root.TryGetProperty("judge", out var jd) && jd.TryGetProperty("isBreak", out var ib) && ib.ValueKind == JsonValueKind.True;
            DateTimeOffset.TryParse(Str(root, "submittedAt"), out var at);

            db.Submissions.Add(new Submission
            {
                ExternalId = extId, ChatId = Str(root, "chatId"), ScenarioCode = code,
                ModelName = model, PayloadJson = payload, Status = status, IsBreak = isBreak, SubmittedAt = at,
            });
            existing.Add(extId);
            subs++;

            db.Prompts.Add(new Prompt
            {
                Title = $"{code} · {model} · {(isBreak ? "BREAK" : status)}",
                Body = payload, ScenarioCode = code, Source = "import",
                Verdict = isBreak ? "break" : "wall",
                Tags = $"import,{code},{model}",
                CreatedAt = at == default ? DateTimeOffset.UtcNow : at,
            });
            prompts++;
        }

        await db.SaveChangesAsync();
        notes.Add($"imported {subs} submissions, {prompts} prompts");
        return new ImportResult(prompts, subs, 0, 0, notes);
    }

    // modelMap block: "<Name>":{breaks:390,successfulSubmissionCount:8,successfulSubmissionBehaviors:["wb2s2-…",…]
    private static readonly Regex ModelMap = new(
        "\"([^\"]+)\":\\{breaks:(\\d+),successfulSubmissionCount:\\d+,successfulSubmissionBehaviors:\\[([^\\]]*)\\]",
        RegexOptions.Compiled);

    /// <summary>Rebuild the model roster (names are randomized per operator) + break matrix from the chat
    /// page-source paste (modelMap), and refresh each scenario's objective/description from the embedded
    /// behavior map (best-effort). Replaces the models so the operator's own randomized codenames take over.</summary>
    public async Task<ImportResult> ImportPageSourceAsync(string html, string challengeSlug = "ipi-black-2026")
    {
        var notes = new List<string>();
        var challenge = await db.Challenges
            .Include(c => c.Models).ThenInclude(m => m.States)
            .Include(c => c.Scenarios)
            .FirstOrDefaultAsync(c => c.Slug == challengeSlug);
        if (challenge is null) { notes.Add("challenge not found; seed first"); return new ImportResult(0, 0, 0, 0, notes); }

        var bidToCode = challenge.Scenarios.ToDictionary(s => s.BehaviorId, s => s.Code, StringComparer.OrdinalIgnoreCase);

        // ── 1) models: parse modelMap, then REPLACE the roster (handles per-operator random codenames) ──
        var parsed = new List<(string Name, int Breaks, List<string> Behaviors)>();
        foreach (Match m in ModelMap.Matches(html))
        {
            var name = m.Groups[1].Value;
            if (name.Contains("http") || name.Length is > 48 or < 2) continue;
            if (!int.TryParse(m.Groups[2].Value, out var breaks)) continue;
            var behaviors = Regex.Matches(m.Groups[3].Value, "\"([^\"]+)\"").Select(x => x.Groups[1].Value).ToList();
            parsed.Add((name, breaks, behaviors));
        }

        int modelsUpdated = 0, breaksSet = 0;
        if (parsed.Count > 0)
        {
            var oldWave = challenge.Models.GroupBy(m => m.Name).ToDictionary(g => g.Key, g => g.First().Wave);   // preserve manual wave across re-import
            db.Models.RemoveRange(challenge.Models);
            challenge.Models.Clear();
            foreach (var p in parsed.GroupBy(x => x.Name).Select(g => g.First()))
            {
                var agent = new ModelAgent { Name = p.Name, FieldBreaks = p.Breaks, ChallengeId = challenge.Id, Wave = oldWave.GetValueOrDefault(p.Name, "") };
                var waves = new Dictionary<string, int>();
                foreach (var bid in p.Behaviors)
                {
                    var w = Regex.Match(bid, "^(?:wb|bb)(\\d)", RegexOptions.IgnoreCase);   // wave digit in wb2s1 / bb1s3
                    if (w.Success) waves[w.Groups[1].Value] = waves.GetValueOrDefault(w.Groups[1].Value) + 1;
                    if (bidToCode.TryGetValue(bid, out var code)) { agent.States.Add(new ScenarioState { ScenarioCode = code, Verdict = "break" }); breaksSet++; }
                }
                agent.WaveBreaksJson = JsonSerializer.Serialize(waves);
                challenge.Models.Add(agent);
                modelsUpdated++;
            }
            notes.Add($"roster replaced: {modelsUpdated} models, {breaksSet} break states");
        }
        else notes.Add("no modelMap found in the paste — models unchanged (paste the full chat page source)");

        // ── 2) scenario descriptions from the embedded behavior map (best-effort) ──
        var scen = 0;
        foreach (var s in challenge.Scenarios)
        {
            if (string.IsNullOrEmpty(s.BehaviorId)) continue;
            var obj = ExtractBehaviorText(html, s.BehaviorId);
            if (!string.IsNullOrWhiteSpace(obj)) { s.Objective = obj!; scen++; }
        }
        notes.Add(scen > 0 ? $"updated {scen} scenario descriptions" : "no scenario descriptions parsed (paste the full chat page source)");

        await db.SaveChangesAsync();
        return new ImportResult(0, 0, modelsUpdated, breaksSet, notes);
    }

    /// <summary>Best-effort: find a behaviorId's entry in the embedded JS behavior map and pull a human
    /// objective/description/instruction string out of a bounded window after it.</summary>
    private static string? ExtractBehaviorText(string html, string behaviorId)
    {
        // require the behaviorId to be a MAP KEY ("bid":{ or bid:{ ), not just a string in an array
        var key = Regex.Match(html, "(?:\"" + Regex.Escape(behaviorId) + "\"|\\b" + Regex.Escape(behaviorId) + ")\\s*:\\s*\\{", RegexOptions.IgnoreCase);
        if (!key.Success) return null;
        var start = key.Index + key.Length;
        var window = html.Substring(start, Math.Min(4000, html.Length - start));
        var m = Regex.Match(window, "(?:description|objective|instructions?|task|goal|prompt|summary)\"?\\s*:\\s*\"((?:\\\\.|[^\"\\\\])+)\"", RegexOptions.IgnoreCase);
        if (!m.Success) return null;
        var raw = m.Groups[1].Value;
        try { raw = Regex.Unescape(raw); } catch { /* leave as-is */ }
        raw = raw.Trim();
        return raw.Length is >= 8 and <= 1200 ? raw : null;
    }

    private static string Str(JsonElement e, string prop) =>
        e.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
}
