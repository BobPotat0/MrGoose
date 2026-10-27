using Microsoft.EntityFrameworkCore;

namespace MrGoose.Backend.Data;

/// <summary>Fresh SQLite store for Mr Goose. Created with EnsureCreated at startup (no migrations yet).</summary>
public class MrGooseDb(DbContextOptions<MrGooseDb> options) : DbContext(options)
{
    public DbSet<Challenge> Challenges => Set<Challenge>();
    public DbSet<Scenario> Scenarios => Set<Scenario>();
    public DbSet<Surface> Surfaces => Set<Surface>();
    public DbSet<Marker> Markers => Set<Marker>();
    public DbSet<ReconNote> ReconNotes => Set<ReconNote>();
    public DbSet<ModelAgent> Models => Set<ModelAgent>();
    public DbSet<ScenarioState> ScenarioStates => Set<ScenarioState>();
    public DbSet<Prompt> Prompts => Set<Prompt>();
    public DbSet<Technique> Techniques => Set<Technique>();
    public DbSet<TechniqueTag> TechniqueTags => Set<TechniqueTag>();
    public DbSet<SelectorProfile> SelectorProfiles => Set<SelectorProfile>();
    public DbSet<Submission> Submissions => Set<Submission>();
    public DbSet<AppSetting> Settings => Set<AppSetting>();
    public DbSet<DossierTool> DossierTools => Set<DossierTool>();
    public DbSet<FiredCall> FiredCalls => Set<FiredCall>();
    public DbSet<DossierFact> DossierFacts => Set<DossierFact>();
    public DbSet<DossierInjection> DossierInjections => Set<DossierInjection>();
    public DbSet<BuildingBlock> BuildingBlocks => Set<BuildingBlock>();
    public DbSet<ChatSession> ChatSessions => Set<ChatSession>();
    public DbSet<ChatTurn> ChatTurns => Set<ChatTurn>();
    public DbSet<PromptFolder> PromptFolders => Set<PromptFolder>();
    public DbSet<KnowledgeNote> KnowledgeNotes => Set<KnowledgeNote>();
    public DbSet<OpenRouterKey> OpenRouterKeys => Set<OpenRouterKey>();

    public DbSet<AgentFile> AgentFiles => Set<AgentFile>();
    public DbSet<ControlAttempt> ControlAttempts => Set<ControlAttempt>();
    public DbSet<ControlObservation> ControlObservations => Set<ControlObservation>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<ControlAttempt>().HasIndex(x => new { x.Owner, x.RequestKey }).IsUnique();
        b.Entity<ControlObservation>().HasIndex(x => new { x.AttemptId, x.RequestKey }).IsUnique();
        b.Entity<AgentFile>().HasIndex(f => f.SessionId);
        b.Entity<AppSetting>().HasKey(x => x.Key);
        b.Entity<Challenge>().HasIndex(c => c.Slug).IsUnique();
        b.Entity<Scenario>().HasIndex(s => new { s.ChallengeId, s.Code });
        b.Entity<ModelAgent>().HasIndex(m => new { m.ChallengeId, m.Name });
        b.Entity<ScenarioState>().HasIndex(s => new { s.ModelAgentId, s.ScenarioCode });
        b.Entity<TechniqueTag>().HasIndex(t => t.Key).IsUnique();
    }
}
