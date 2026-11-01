using System.Globalization;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend.Data;

namespace MrGoose.Backend.Services;

/// <summary>Per-role model configuration (model · reasoning · temperature) for the Organizer and the
/// Attacker, stored as flat Settings keys ("organizer.model", "attacker.reasoning", …). Each falls back to
/// the shared "openrouter.model", then a sane default — so older stores keep working and both the role tab
/// and the Settings tab read/write the SAME keys (one source of truth → the two UIs stay mirrored).</summary>
public static class RoleSettings
{
    public const string Default = "default";   // reasoning: omit the param, let the model decide
    public record Config(string Model, string Reasoning, double Temperature);

    public static async Task<Config> ResolveAsync(MrGooseDb db, string role)
    {
        var all = await db.Settings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value);
        return Resolve(all, role);
    }

    public static Config Resolve(IReadOnlyDictionary<string, string> all, string role)
    {
        string Get(string k) => all.TryGetValue(k, out var v) ? v : "";

        var model = Get($"{role}.model");
        if (string.IsNullOrWhiteSpace(model)) model = Get("openrouter.model");
        if (string.IsNullOrWhiteSpace(model)) model = "openai/gpt-4o-mini";

        var reasoning = Get($"{role}.reasoning");
        if (string.IsNullOrWhiteSpace(reasoning)) reasoning = Default;

        var temperature = ParseTemperature(Get($"{role}.temperature"));
        return new Config(model, reasoning, temperature);
    }

    public static double ParseTemperature(string? raw) =>
        double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var t) ? t : 0.7;
}
