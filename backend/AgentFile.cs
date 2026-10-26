namespace MrGoose.Backend;

/// <summary>A text artifact owned by a single local agent conversation.</summary>
public class AgentFile
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string SessionId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Source { get; set; } = "agent";
    public string Content { get; set; } = "";
    public int Size { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
