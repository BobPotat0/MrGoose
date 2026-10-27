using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MrGoose.Backend.Services;

public record ChatMsg(string Role, string Content);

/// <summary>Thin OpenRouter chat-completions client: SSE streaming for simple chat + a non-streaming
/// tool-calling round for the attacker agent loop. The victim's responses come from the real arena,
/// never from here.</summary>
public class OpenRouterClient(IHttpClientFactory factory)
{
    /// <summary>One non-streaming completion round with tool support. `messages` is the running
    /// conversation (system + user/assistant/tool). Returns the assistant message node (detached),
    /// which carries `content` and/or `tool_calls` — append it back before adding tool results.</summary>
    public async Task<JsonNode> CompleteAsync(
        string apiKey, string model, IEnumerable<JsonNode> messages, JsonArray? tools, CancellationToken ct = default)
    {
        var http = factory.CreateClient();
        http.Timeout = TimeSpan.FromMinutes(5);

        var reqMessages = new JsonArray();
        foreach (var m in messages) reqMessages.Add(m.DeepClone());

        var body = new JsonObject { ["model"] = model, ["messages"] = reqMessages, ["temperature"] = 0.7 };
        if (tools is { Count: > 0 }) { body["tools"] = tools.DeepClone(); body["tool_choice"] = "auto"; }

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://openrouter.ai/api/v1/chat/completions");
        req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {Ascii(apiKey)}");
        req.Headers.TryAddWithoutValidation("X-Title", "Mr Goose");
        req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");

        using var resp = await http.SendAsync(req, ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            return new JsonObject { ["role"] = "assistant", ["content"] = $"[openrouter error {(int)resp.StatusCode}] {Trim(text)}" };

        var msg = JsonNode.Parse(text)?["choices"]?[0]?["message"];
        return msg?.DeepClone() ?? new JsonObject { ["role"] = "assistant", ["content"] = "[openrouter: empty response]" };
    }

    /// <summary>Streaming completion with tool support + reasoning. Streams content tokens to
    /// <paramref name="onContent"/> and reasoning tokens to <paramref name="onReasoning"/>, accumulates any
    /// streamed tool_calls, and returns the finished assistant message node (content + tool_calls) for the loop.</summary>
    public async Task<JsonNode> StreamCompleteAsync(
        string apiKey, string model, IEnumerable<JsonNode> messages, JsonArray? tools,
        Func<string, Task> onContent, Func<string, Task>? onReasoning, CancellationToken ct = default)
    {
        var http = factory.CreateClient();
        http.Timeout = TimeSpan.FromMinutes(5);

        var reqMessages = new JsonArray();
        foreach (var m in messages) reqMessages.Add(m.DeepClone());

        var body = new JsonObject { ["model"] = model, ["messages"] = reqMessages, ["temperature"] = 0.7, ["stream"] = true, ["reasoning"] = new JsonObject() };
        if (tools is { Count: > 0 }) { body["tools"] = tools.DeepClone(); body["tool_choice"] = "auto"; }

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://openrouter.ai/api/v1/chat/completions");
        req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {Ascii(apiKey)}");
        req.Headers.TryAddWithoutValidation("X-Title", "Mr Goose");
        req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");

        using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            var msg = $"[openrouter error {(int)resp.StatusCode}] {Trim(err)}";
            await onContent(msg);
            return new JsonObject { ["role"] = "assistant", ["content"] = msg };
        }

        var content = new StringBuilder();
        var acc = new SortedDictionary<int, ToolAcc>();
        using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        string? line;
        while ((line = await reader.ReadLineAsync(ct)) is not null)
        {
            if (string.IsNullOrWhiteSpace(line) || !line.StartsWith("data:")) continue;
            var data = line["data:".Length..].Trim();
            if (data == "[DONE]") break;
            try
            {
                var delta = JsonDocument.Parse(data).RootElement.GetProperty("choices")[0].GetProperty("delta");
                if (delta.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String)
                { var s = c.GetString() ?? ""; if (s.Length > 0) { content.Append(s); await onContent(s); } }
                if (onReasoning is not null)
                {
                    string? rs = null;
                    if (delta.TryGetProperty("reasoning", out var r) && r.ValueKind == JsonValueKind.String) rs = r.GetString();
                    else if (delta.TryGetProperty("reasoning_content", out var r2) && r2.ValueKind == JsonValueKind.String) rs = r2.GetString();
                    if (!string.IsNullOrEmpty(rs)) await onReasoning(rs);
                }
                if (delta.TryGetProperty("tool_calls", out var tcs) && tcs.ValueKind == JsonValueKind.Array)
                    foreach (var tc in tcs.EnumerateArray())
                    {
                        var idx = tc.TryGetProperty("index", out var ix) && ix.TryGetInt32(out var n) ? n : 0;
                        if (!acc.TryGetValue(idx, out var a)) { a = new ToolAcc(); acc[idx] = a; }
                        if (tc.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String) a.Id = id.GetString() ?? a.Id;
                        if (tc.TryGetProperty("function", out var fn))
                        {
                            if (fn.TryGetProperty("name", out var nm) && nm.ValueKind == JsonValueKind.String) a.Name = nm.GetString() ?? a.Name;
                            if (fn.TryGetProperty("arguments", out var ar) && ar.ValueKind == JsonValueKind.String) a.Args.Append(ar.GetString());
                        }
                    }
            }
            catch { /* keep-alive / partial frame */ }
        }

        var assistant = new JsonObject { ["role"] = "assistant", ["content"] = content.Length > 0 ? content.ToString() : null };
        if (acc.Count > 0)
        {
            var arr = new JsonArray();
            foreach (var kv in acc)
                arr.Add(new JsonObject { ["id"] = kv.Value.Id, ["type"] = "function", ["function"] = new JsonObject { ["name"] = kv.Value.Name, ["arguments"] = kv.Value.Args.ToString() } });
            assistant["tool_calls"] = arr;
        }
        return assistant;
    }

    private sealed class ToolAcc { public string Id = ""; public string Name = ""; public StringBuilder Args = new(); }

    public async IAsyncEnumerable<string> StreamAsync(
        string apiKey, string model, IEnumerable<ChatMsg> messages,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var http = factory.CreateClient();
        http.Timeout = TimeSpan.FromMinutes(5);

        var payload = new
        {
            model,
            stream = true,
            messages = messages.Select(m => new { role = m.Role, content = m.Content }).ToArray(),
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://openrouter.ai/api/v1/chat/completions");
        req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {Ascii(apiKey)}");
        req.Headers.TryAddWithoutValidation("X-Title", "Mr Goose");
        req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            yield return $"[openrouter error {(int)resp.StatusCode}] {Trim(err)}";
            yield break;
        }

        using var stream = await resp.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        string? line;
        while ((line = await reader.ReadLineAsync(ct)) is not null)
        {
            if (string.IsNullOrWhiteSpace(line) || !line.StartsWith("data:")) continue;
            var data = line["data:".Length..].Trim();
            if (data == "[DONE]") break;

            string? token = null;
            try
            {
                var delta = JsonDocument.Parse(data).RootElement
                    .GetProperty("choices")[0].GetProperty("delta");
                if (delta.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String)
                    token = c.GetString();
            }
            catch { /* keep-alive / non-delta line */ }

            if (!string.IsNullOrEmpty(token)) yield return token;
        }
    }

    // ── model catalog (cached) + credit balance ──
    private JsonArray? _modelsCache;
    private DateTimeOffset _modelsAt;

    public async Task<JsonArray> GetModelsAsync(CancellationToken ct = default)
    {
        if (_modelsCache is not null && DateTimeOffset.UtcNow - _modelsAt < TimeSpan.FromMinutes(30)) return _modelsCache;
        try
        {
            var http = factory.CreateClient();
            using var resp = await http.GetAsync("https://openrouter.ai/api/v1/models", ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            var data = JsonNode.Parse(text)?["data"] as JsonArray;
            if (data is not null) { _modelsCache = data.DeepClone() as JsonArray; _modelsAt = DateTimeOffset.UtcNow; }
        }
        catch { /* keep stale/empty */ }
        return _modelsCache ?? new JsonArray();
    }

    /// <summary>Returns (totalCredits, totalUsage) from OpenRouter, or null on failure.</summary>
    public async Task<(double credits, double usage)?> GetCreditsAsync(string apiKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(apiKey)) return null;
        try
        {
            var http = factory.CreateClient();
            using var req = new HttpRequestMessage(HttpMethod.Get, "https://openrouter.ai/api/v1/credits");
            req.Headers.TryAddWithoutValidation("Authorization", $"Bearer {Ascii(apiKey)}");
            using var resp = await http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode) return null;
            var d = JsonNode.Parse(await resp.Content.ReadAsStringAsync(ct))?["data"];
            if (d is null) return null;
            var credits = d["total_credits"]?.GetValue<double>() ?? 0;
            var usage = d["total_usage"]?.GetValue<double>() ?? 0;
            return (credits, usage);
        }
        catch { return null; }
    }

    private static string Trim(string s) => s.Length > 300 ? s[..300] : s;
    // Strip anything outside printable ASCII so a key with a stray invisible/non-ASCII char can't crash the header.
    private static string Ascii(string s) => new((s ?? "").Where(c => c > 32 && c < 127).ToArray());
}
