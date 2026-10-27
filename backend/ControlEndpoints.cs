using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend.Data;
using MrGoose.Backend.Services;

namespace MrGoose.Backend;

public class ControlAttempt
{
    public string Id { get; set; } = "";
    public string Owner { get; set; } = "";
    public string RequestKey { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public string RecordJson { get; set; } = "{}";
}
public class ControlObservation
{
    public string Id { get; set; } = "";
    public string AttemptId { get; set; } = "";
    public string RequestKey { get; set; } = "";
    public string RecordJson { get; set; } = "{}";
}

public static class ControlEndpoints
{
    public static void EnsureSchema(MrGooseDb db)
    {
        db.Database.OpenConnection();
        var connection = (Microsoft.Data.Sqlite.SqliteConnection)db.Database.GetDbConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ControlAttempts'";
        if (Convert.ToInt32(command.ExecuteScalar()) == 0 && connection.DataSource != ":memory:")
        {
            using var backup = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={connection.DataSource}.pre-mcp-{DateTime.UtcNow:yyyyMMddHHmmssfff}.db");
            backup.Open(); connection.BackupDatabase(backup);
        }
        using var transaction = db.Database.BeginTransaction();
        db.Database.ExecuteSqlRaw(SchemaSql);
        transaction.Commit();
    }

    // Additive, idempotent schema for existing operator DBs. No existing table/data rewrites.
    public const string SchemaSql = """
        CREATE TABLE IF NOT EXISTS ControlSchema (Version INTEGER NOT NULL PRIMARY KEY);
        INSERT OR IGNORE INTO ControlSchema(Version) VALUES(1);
        CREATE TABLE IF NOT EXISTS ControlAttempts (Id TEXT NOT NULL PRIMARY KEY, Owner TEXT NOT NULL, RequestKey TEXT NOT NULL, RequestHash TEXT NOT NULL, RecordJson TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS IX_ControlAttempts_Owner_RequestKey ON ControlAttempts(Owner, RequestKey);
        CREATE TABLE IF NOT EXISTS ControlObservations (Id TEXT NOT NULL PRIMARY KEY, AttemptId TEXT NOT NULL, RequestKey TEXT NOT NULL, RecordJson TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS IX_ControlObservations_AttemptId_RequestKey ON ControlObservations(AttemptId, RequestKey);
        """;

    public static void MapControl(this WebApplication app)
    {
        // Private to authenticated Electron. External MCP clients never receive the backend token.
        app.MapPost("/api/control/{operation}", async (string operation, JsonElement args, MrGooseDb db, LibraryQueryService library) =>
        {
            string S(string key, string fallback = "") => args.TryGetProperty(key, out var x) && x.ValueKind == JsonValueKind.String ? x.GetString()! : fallback;
            int I(string key, int fallback) => args.TryGetProperty(key, out var x) && x.TryGetInt32(out var i) ? i : fallback;
            object? Content(string json) => JsonSerializer.Deserialize<JsonElement>(json);
            try
            {
                if (operation == "library_search") return Results.Ok(await library.Search(S("collection"), S("query"), S("challengeSlug") is "" ? null : S("challengeSlug"), I("offset", 0), I("limit", 10)));
                if (operation == "library_read")
                {
                    var value = await library.Read(S("collection"), S("id"), S("challengeSlug") is "" ? null : S("challengeSlug"), I("offset", 0), I("limit", 8000), S("expectedHash") is "" ? null : S("expectedHash"));
                    return value == null ? Results.NotFound(new { code = "NOT_FOUND" }) : Results.Ok(value);
                }
                if (operation == "context")
                {
                    var slug = S("challengeSlug"); var scenarioId = I("scenarioId", 0); var modelId = I("modelId", 0);
                    var scenario = await db.Scenarios.AsNoTracking().Include(x => x.Challenge).FirstOrDefaultAsync(x => x.Id == scenarioId && x.Challenge!.Slug == slug);
                    var model = await db.Models.AsNoTracking().FirstOrDefaultAsync(x => x.Id == modelId && x.Challenge!.Slug == slug);
                    if (scenario == null || model == null) return Results.NotFound(new { code = "CONTEXT_NOT_FOUND" });
                    return Results.Ok(new { challengeSlug = slug, scenario = new { scenario.Id, scenario.Code, scenario.Name, scenario.BehaviorId }, model = new { model.Id, model.Name } });
                }
                var owner = S("owner");
                if (owner.Length is < 1 or > 100) return Results.BadRequest(new { code = "INVALID_OWNER" });
                if (operation == "attempts") return Results.Ok((await db.ControlAttempts.AsNoTracking().Where(x => x.Owner == owner).OrderBy(x => x.Id).Skip(I("offset", 0)).Take(Math.Clamp(I("limit", 10), 1, 25)).ToListAsync()).Select(x =>
                {
                    var record = JsonSerializer.Deserialize<JsonElement>(x.RecordJson);
                    return new { x.Id, state = record.GetProperty("state").GetString(), createdAt = record.GetProperty("createdAt").GetString(), context = record.GetProperty("context"), generation = record.GetProperty("generation").GetString() };
                }));
                if (operation == "attempt_find")
                {
                    var key = S("requestKey");
                    var found = await db.ControlAttempts.AsNoTracking().FirstOrDefaultAsync(x => x.Owner == owner && x.RequestKey == key);
                    return Results.Ok(found == null ? (object)new { found = false } : new { found = true, found.Id, found.RequestHash, record = Content(found.RecordJson) });
                }
                if (operation == "attempt_create")
                {
                    var entity = new ControlAttempt { Id = S("id"), Owner = owner, RequestKey = S("requestKey"), RequestHash = S("requestHash"), RecordJson = args.GetProperty("record").GetRawText() };
                    db.ControlAttempts.Add(entity); await db.SaveChangesAsync(); return Results.Ok(Content(entity.RecordJson));
                }
                var id = S("attemptId");
                var attempt = await db.ControlAttempts.FirstOrDefaultAsync(x => x.Id == id && x.Owner == owner);
                if (attempt == null) return Results.NotFound(new { code = "ATTEMPT_NOT_FOUND" });
                if (operation == "attempt_get") return Results.Ok(Content(attempt.RecordJson));
                if (operation == "attempt_update") { attempt.RecordJson = args.GetProperty("record").GetRawText(); await db.SaveChangesAsync(); return Results.Ok(Content(attempt.RecordJson)); }
                if (operation == "observations") return Results.Ok((await db.ControlObservations.AsNoTracking().Where(x => x.AttemptId == id).OrderBy(x => x.Id).Skip(I("offset", 0)).Take(Math.Clamp(I("limit", 10), 1, 25)).ToListAsync()).Select(x => Content(x.RecordJson)));
                if (operation == "observation_find")
                {
                    var key = S("requestKey");
                    var existing = await db.ControlObservations.AsNoTracking().FirstOrDefaultAsync(x => x.AttemptId == id && x.RequestKey == key);
                    return Results.Ok(existing == null ? (object)new { found = false } : new { found = true, record = Content(existing.RecordJson) });
                }
                if (operation == "observation_save")
                {
                    var key = S("requestKey");
                    var existing = await db.ControlObservations.AsNoTracking().FirstOrDefaultAsync(x => x.AttemptId == id && x.RequestKey == key);
                    if (existing != null) return Results.Ok(Content(existing.RecordJson));
                    var observation = new ControlObservation { Id = S("id"), AttemptId = id, RequestKey = key, RecordJson = args.GetProperty("record").GetRawText() };
                    db.ControlObservations.Add(observation); await db.SaveChangesAsync(); return Results.Ok(Content(observation.RecordJson));
                }
                return Results.BadRequest(new { code = "UNKNOWN_OPERATION" });
            }
            catch (ArgumentException e) { return Results.BadRequest(new { code = "INVALID_ARGUMENT", message = e.Message }); }
            catch (InvalidOperationException e) { return Results.Conflict(new { code = e.Message == "CONTENT_CHANGED" ? e.Message : "STATE_CONFLICT" }); }
            catch (DbUpdateException) { return Results.Conflict(new { code = "STATE_CONFLICT" }); }
        });
    }
}
