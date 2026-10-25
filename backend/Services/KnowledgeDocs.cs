namespace MrGoose.Backend.Services;

/// <summary>Reads the agent's file-based knowledge base: the <c>knowledge/*.md</c> docs that describe how
/// Mr Goose works. They are copied next to the exe (see the csproj) and appended to the agent's system prompt
/// so it always knows the program; the agent can also pull one on demand with its read_doc tool.</summary>
public static class KnowledgeDocs
{
    public record Doc(string Name, string Content);

    private static string? Dir()
    {
        foreach (var c in new[]
        {
            Path.Combine(AppContext.BaseDirectory, "knowledge"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "knowledge"), // dev: bin/Debug/net10.0 → project/knowledge
        })
            if (Directory.Exists(c)) return c;
        return null;
    }

    public static List<Doc> All()
    {
        var dir = Dir();
        if (dir is null) return new();
        return Directory.GetFiles(dir, "*.md").OrderBy(f => f, StringComparer.Ordinal)
            .Select(f => { try { return new Doc(Path.GetFileName(f), File.ReadAllText(f)); } catch { return new Doc(Path.GetFileName(f), ""); } })
            .ToList();
    }

    public static string? Read(string name)
    {
        var dir = Dir(); if (dir is null) return null;
        var safe = Path.GetFileName(name);   // no traversal
        var path = Path.Combine(dir, safe);
        return File.Exists(path) ? File.ReadAllText(path) : null;
    }
}
