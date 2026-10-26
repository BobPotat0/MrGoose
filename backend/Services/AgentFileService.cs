using System.Text;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend.Data;

namespace MrGoose.Backend.Services;

public class AgentFileService(MrGooseDb db)
{
    public const int MaxBytes = 1024 * 1024;
    public const string SchemaSql = """
        CREATE TABLE IF NOT EXISTS AgentFiles (
            Id TEXT NOT NULL CONSTRAINT PK_AgentFiles PRIMARY KEY,
            SessionId TEXT NOT NULL, Name TEXT NOT NULL, Source TEXT NOT NULL DEFAULT 'agent', Content TEXT NOT NULL,
            Size INTEGER NOT NULL, CreatedAt TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS IX_AgentFiles_SessionId ON AgentFiles (SessionId);
        """;

    public static string Session(string? id) => Guid.TryParse(id, out var parsed)
        ? parsed.ToString("N") : throw new ArgumentException("A valid conversation session is required.");

    public static object Info(AgentFile f) => new { id = f.Id, name = f.Name, size = f.Size, createdAt = f.CreatedAt, source = f.Source };

    public async Task<AgentFile> CreateAsync(string? sessionId, string name, string content, bool uploaded = false)
    {
        var session = Session(sessionId);
        name = name.Trim();
        if (name.Length is < 1 or > 120 || name is "." or ".." || name.Any(c => char.IsControl(c) || "<>:\"/\\|?*".Contains(c))
            || !new[] { ".txt", ".md", ".json", ".csv" }.Contains(Path.GetExtension(name).ToLowerInvariant()))
            throw new ArgumentException("Use a simple filename ending in .txt, .md, .json or .csv (up to 120 characters).");
        var size = Encoding.UTF8.GetByteCount(content);
        if (size > MaxBytes) throw new ArgumentException("A file may contain at most 1 MiB of UTF-8 text.");
        var existing = await db.AgentFiles.Where(f => f.SessionId == session).Select(f => f.Size).ToListAsync();
        if (existing.Count >= 100 || existing.Sum() + size > 10 * MaxBytes)
            throw new ArgumentException("This session's file limit has been reached (100 files / 10 MiB).");
        // New id on every creation: a model cannot silently overwrite an earlier artifact.
        var file = new AgentFile { SessionId = session, Name = name, Content = content, Size = size, Source = uploaded ? "upload" : "agent" };
        db.AgentFiles.Add(file); await db.SaveChangesAsync(); return file;
    }

    public async Task<List<AgentFile>> ListAsync(string? sessionId)
    {
        var session = Session(sessionId);
        // SQLite cannot order DateTimeOffset directly; sort metadata after the bounded query.
        return (await db.AgentFiles.AsNoTracking().Where(f => f.SessionId == session)
            .Select(f => new AgentFile { Id = f.Id, SessionId = f.SessionId, Name = f.Name, Source = f.Source, Size = f.Size, CreatedAt = f.CreatedAt })
            .ToListAsync()).OrderByDescending(f => f.CreatedAt).ThenBy(f => f.Id).ToList();
    }

    public async Task DeleteSessionAsync(string? sessionId)
    {
        var session = Session(sessionId);
        await db.AgentFiles.Where(f => f.SessionId == session).ExecuteDeleteAsync();
    }

    public Task<AgentFile?> ReadAsync(string? sessionId, string id)
    {
        var session = Session(sessionId);
        return db.AgentFiles.AsNoTracking().FirstOrDefaultAsync(f => f.SessionId == session && f.Id == id);
    }
}
