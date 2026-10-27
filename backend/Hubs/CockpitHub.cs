using System.Text.Json.Nodes;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend.Data;
using MrGoose.Backend.Services;

namespace MrGoose.Backend.Hubs;

public record ChatMsgDto(string Role, string Content);
public record AttackerSendRequest(string ScenarioCode, string ModelName, string SystemPrompt, List<ChatMsgDto> Messages);

/// <summary>
/// Live channel to the cockpit. P0: handshake. P4/P5: runs the attacker tool-loop — the model reads
/// the dossier and records findings into it (record_*), then crafts. Streams tool activity ("attackerTool")
/// + the final answer ("attackerToken") + "attackerDone". Nothing here sends/submits to the arena.
/// </summary>
public sealed class CockpitHub(MrGooseDb db, OpenRouterClient openRouter, AttackerService craft, FinderService finder, OrganizerService agent) : Hub
{
    private const int MaxRounds = 6;

    // pending client-mediated page actions for the Mr Goose Organizer (keyed by action id)
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (string ConnectionId, TaskCompletionSource<string> Completion)> PagePending = new();

    /// <summary>The Mr Goose Organizer: a tool-using loop over the whole app. DATA tools run server-side;
    /// PAGE tools (arena_*) are executed by the client via the Electron bridge and returned here.</summary>
    public async Task OrganizerChat(List<ChatMsgDto> messages, string? sessionId = null)
    {
        var key = await KeyStore.GetActiveKeyAsync(db);
        var model = (await db.Settings.FindAsync("openrouter.model"))?.Value ?? "";
        if (string.IsNullOrWhiteSpace(key))
        {
            await Clients.Caller.SendAsync("organizerToken", "⚠ No OpenRouter key set. Add it in Settings.");
            await Clients.Caller.SendAsync("organizerDone", new { ok = false });
            return;
        }
        if (string.IsNullOrWhiteSpace(model)) model = "openai/gpt-4o-mini";

        var tools = OrganizerService.BuildTools();
        var msgs = new List<JsonNode> { Msg("system", await OrganizerService.BuildSystemAsync(db)) };
        foreach (var m in messages) msgs.Add(Msg(m.Role, m.Content));

        try
        {
            for (var round = 0; round < 10; round++)
            {
                var assistant = await openRouter.StreamCompleteAsync(key, model, msgs, tools,
                    tok => Clients.Caller.SendAsync("organizerToken", tok),
                    tok => Clients.Caller.SendAsync("organizerReasoning", tok),
                    Context.ConnectionAborted);
                msgs.Add(assistant);
                if (assistant["tool_calls"] is not JsonArray calls || calls.Count == 0) break;

                foreach (var tc in calls)
                {
                    var id = tc?["id"]?.GetValue<string>() ?? "";
                    var name = tc?["function"]?["name"]?.GetValue<string>() ?? "";
                    var args = tc?["function"]?["arguments"]?.GetValue<string>() ?? "{}";
                    await Clients.Caller.SendAsync("organizerTool", new { name, args });
                    var result = OrganizerService.IsPageTool(name)
                        ? await MediatePageToolAsync(name, args)
                        : await agent.ExecuteDataToolAsync(name, args, sessionId);
                    if (name == "create_file" && JsonNode.Parse(result)?["file"] is JsonNode savedFile)
                        await Clients.Caller.SendAsync("organizerFile", savedFile);
                    if (name == "show_techniques")
                    {
                        var rows = JsonNode.Parse(result) as JsonArray ?? new JsonArray();
                        await Clients.Caller.SendAsync("organizerTechniques", rows);
                        result = $"Displayed a snapshot of all {rows.Count} current techniques in the operator's chat. No techniques were changed.";
                    }
                    if (name == "open_in_view" && JsonNode.Parse(result) is JsonObject opened && opened["kind"] is not null && opened["id"] is not null)
                        await Clients.Caller.SendAsync("organizerOpen", new { kind = opened["kind"]!.GetValue<string>(), id = opened["id"]!.GetValue<string>() });
                    msgs.Add(ToolMsg(id, name, result));
                }
            }
            await Clients.Caller.SendAsync("organizerDone", new { ok = true });
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("organizerToken", $"\n[error] {ex.Message}");
            await Clients.Caller.SendAsync("organizerDone", new { ok = false });
        }
    }

    private async Task<string> MediatePageToolAsync(string name, string argsJson)
    {
        var id = Guid.NewGuid().ToString("N");
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        PagePending[id] = (Context.ConnectionId, tcs);
        await Clients.Caller.SendAsync("organizerPageAction", new { id, name, args = argsJson });
        var done = await Task.WhenAny(tcs.Task, Task.Delay(60000));
        if (done != tcs.Task) { PagePending.TryRemove(id, out _); return "[page action timed out]"; }
        return await tcs.Task;
    }

    /// <summary>The client returns the result of a page action it executed via the Electron bridge.</summary>
    public Task OrganizerPageResult(string id, string result)
    {
        if (PagePending.TryGetValue(id, out var pending) && pending.ConnectionId == Context.ConnectionId && PagePending.TryRemove(id, out _)) pending.Completion.TrySetResult(result);
        return Task.CompletedTask;
    }

    /// <summary>Stream the next direct-jailbreak instructor prompt for a Finder hunt. Tokens → "finderToken",
    /// completion → "finderDone". The client records the instructor turn + drives fill/send/read-back/judge.</summary>
    public async Task FinderCraft(int sessionId)
    {
        var key = await KeyStore.GetActiveKeyAsync(db);
        var model = (await db.Settings.FindAsync("openrouter.model"))?.Value ?? "";
        if (string.IsNullOrWhiteSpace(key))
        {
            await Clients.Caller.SendAsync("finderToken", "⚠ No OpenRouter key set. Add it in Settings to use the instructor.");
            await Clients.Caller.SendAsync("finderDone", new { ok = false });
            return;
        }
        if (string.IsNullOrWhiteSpace(model)) model = "openai/gpt-4o-mini";

        var session = await db.ChatSessions.Include(s => s.Turns).FirstOrDefaultAsync(s => s.Id == sessionId);
        if (session is null) { await Clients.Caller.SendAsync("finderDone", new { ok = false }); return; }

        var turns = session.Turns.OrderBy(t => t.CreatedAt).ToList();
        var lastVictim = turns.LastOrDefault(t => t.Role == "victim");
        var lastScore = turns.LastOrDefault(t => t.Role == "judge")?.Score;

        var user = finder.BuildInstructorUser(session, lastVictim?.Content, lastScore, turns);
        var msgs = new List<JsonNode> { Msg("system", FinderService.InstructorSystem), Msg("user", user) };

        try
        {
            await openRouter.StreamCompleteAsync(key, model, msgs, null,
                tok => Clients.Caller.SendAsync("finderToken", tok),
                tok => Clients.Caller.SendAsync("finderReasoning", tok),
                Context.ConnectionAborted);
            await Clients.Caller.SendAsync("finderDone", new { ok = true });
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("finderToken", $"\n[error] {ex.Message}");
            await Clients.Caller.SendAsync("finderDone", new { ok = false });
        }
    }

    public override async Task OnConnectedAsync()
    {
        await Clients.Caller.SendAsync("welcome", new { message = "Mr Goose backend connected.", connectionId = Context.ConnectionId, utc = DateTimeOffset.UtcNow });
        await base.OnConnectedAsync();
    }

    public Task Ping(string message) =>
        Clients.Caller.SendAsync("pong", new { echo = message, utc = DateTimeOffset.UtcNow });

    public async Task AttackerSend(AttackerSendRequest req)
    {
        var key = await KeyStore.GetActiveKeyAsync(db);
        var model = (await db.Settings.FindAsync("openrouter.model"))?.Value ?? "";
        if (string.IsNullOrWhiteSpace(key))
        {
            await Clients.Caller.SendAsync("attackerToken", "⚠ No OpenRouter key set. Add it in Settings to use the attacker.");
            await Clients.Caller.SendAsync("attackerDone", new { ok = false });
            return;
        }
        if (string.IsNullOrWhiteSpace(model)) model = "openai/gpt-4o-mini";

        var system = string.IsNullOrWhiteSpace(req.SystemPrompt)
            ? await craft.BuildSystemPromptAsync(new AttackerService.PromptSelection(req.ScenarioCode, req.ModelName, [], [], [], true))
            : req.SystemPrompt;

        var messages = new List<JsonNode> { Msg("system", system) };
        foreach (var m in req.Messages) messages.Add(Msg(m.Role, m.Content));

        var tools = AttackerService.BuildTools();

        try
        {
            for (var round = 0; round < MaxRounds; round++)
            {
                var assistant = await openRouter.StreamCompleteAsync(key, model, messages, tools,
                    tok => Clients.Caller.SendAsync("attackerToken", tok),
                    tok => Clients.Caller.SendAsync("attackerReasoning", tok),
                    Context.ConnectionAborted);
                messages.Add(assistant);

                if (assistant["tool_calls"] is not JsonArray calls || calls.Count == 0) break;

                foreach (var tc in calls)
                {
                    var id = tc?["id"]?.GetValue<string>() ?? "";
                    var name = tc?["function"]?["name"]?.GetValue<string>() ?? "";
                    var args = tc?["function"]?["arguments"]?.GetValue<string>() ?? "{}";
                    await Clients.Caller.SendAsync("attackerTool", new { name, args });
                    var result = await craft.ExecuteToolAsync(req.ModelName, req.ScenarioCode, name, args);
                    messages.Add(ToolMsg(id, name, result));
                }
            }
            await Clients.Caller.SendAsync("attackerDone", new { ok = true });
        }
        catch (Exception ex)
        {
            await Clients.Caller.SendAsync("attackerToken", $"\n[error] {ex.Message}");
            await Clients.Caller.SendAsync("attackerDone", new { ok = false });
        }
    }

    private static JsonObject Msg(string role, string content) => new() { ["role"] = role, ["content"] = content };
    private static JsonObject ToolMsg(string id, string name, string content) =>
        new() { ["role"] = "tool", ["tool_call_id"] = id, ["name"] = name, ["content"] = content };
}
