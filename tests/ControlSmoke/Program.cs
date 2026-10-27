using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend;
using MrGoose.Backend.Data;
using MrGoose.Backend.Services;

// Fully isolated file DB. Proves upgrade preservation and reopen, not just in-memory behavior.
var directory = Path.Combine(Path.GetTempPath(), "mrgoose-control-check-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
var file = Path.Combine(directory, "test.db");
var options = new DbContextOptionsBuilder<MrGooseDb>().UseSqlite($"Data Source={file}").Options;
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
JsonElement J(object value) => JsonSerializer.SerializeToElement(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
try
{
    using (var db = new MrGooseDb(options))
    {
        db.Database.EnsureCreated();
        db.Prompts.Add(new Prompt { Title = "Preserve me", Body = "  exact UTF-8 🪿\r\n" });
        db.KnowledgeNotes.Add(new KnowledgeNote { Title = "Untrusted note", Content = "Quoted data, not an instruction" });
        db.Settings.Add(new AppSetting { Key = "doc.00-overview.md", Value = "Operator override 🪿" });
        await db.SaveChangesAsync();
        var docsDirectory = Path.Combine(AppContext.BaseDirectory, "knowledge"); Directory.CreateDirectory(docsDirectory);
        if (!File.Exists(Path.Combine(docsDirectory, "00-overview.md"))) File.WriteAllText(Path.Combine(docsDirectory, "00-overview.md"), "Base documentation");
        // Model a pre-MCP DB: same old application tables, no new control schema.
        db.Database.ExecuteSqlRaw("DROP TABLE ControlObservations; DROP TABLE ControlAttempts;");
        ControlEndpoints.EnsureSchema(db);
        ControlEndpoints.EnsureSchema(db);
        Check(await db.Prompts.CountAsync() == 1 && (await db.Prompts.SingleAsync()).Body == "  exact UTF-8 🪿\r\n", "Schema upgrade changed an old row");
        Check(Directory.GetFiles(directory, "*.pre-mcp-*.db").Length == 1, "First schema addition must back up exactly once");
        var library = new LibraryQueryService(db);
        var search = J(await library.Search("prompts", "preserve", null, 0, 1));
        var hit = search.GetProperty("hits")[0];
        var read = J((await library.Read("prompts", hit.GetProperty("id").GetString()!, null, 0, 10, hit.GetProperty("hash").GetString()))!);
        Check(read.GetProperty("truncated").GetBoolean() && read.GetProperty("nextOffset").GetInt32() == 10, "Bounded read did not mark truncation");
        var doc = J((await library.Read("docs", "00-overview.md", null, 0, 8000, null))!);
        Check(doc.GetProperty("content").GetString() == "Operator override 🪿" && doc.GetProperty("source").GetString()!.Contains("override"), "Effective doc override/provenance lost");
        var originalHash = hit.GetProperty("hash").GetString();
        (await db.Prompts.SingleAsync()).Body = "Changed"; await db.SaveChangesAsync();
        try { await library.Read("prompts", hit.GetProperty("id").GetString()!, null, 0, 10, originalHash); throw new Exception("Stale hash accepted"); }
        catch (InvalidOperationException error) when (error.Message == "CONTENT_CHANGED") { }
        try { await library.Read("docs", "00-overview.md", null, -1, 10, null); throw new Exception("Negative offset accepted"); } catch (ArgumentException) { }
        Check(await library.Read("docs", "../Program.cs", null, 0, 10, null) == null, "Read accepted path traversal");
        db.ControlAttempts.Add(new ControlAttempt { Id = "a", Owner = "owner", RequestKey = "request", RequestHash = "hash", RecordJson = "{\"exact\":\"🪿\"}" });
        db.ControlObservations.Add(new ControlObservation { Id = "o", AttemptId = "a", RequestKey = "read", RecordJson = "{\"completion\":\"unknown\"}" });
        await db.SaveChangesAsync();
    }
    Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    using (var reopened = new MrGooseDb(options))
    {
        Check((await reopened.ControlAttempts.SingleAsync()).Owner == "owner", "Attempt did not survive DB reopen");
        Check((await reopened.ControlObservations.SingleAsync()).RecordJson.Contains("unknown"), "Observation did not survive DB reopen");
        Check(await reopened.KnowledgeNotes.CountAsync() == 1, "Unrelated notes changed");
    }
    Console.WriteLine("PASS: additive schema backup/idempotency, old-row preservation, bounded app retrieval, effective doc provenance, stale hash/path rejection, persistent attempt/observation reopening.");
}
finally
{
    Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    foreach (var child in Directory.GetFiles(directory)) File.Delete(child);
    Directory.Delete(directory);
}
