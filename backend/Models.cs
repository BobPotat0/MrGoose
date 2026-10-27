using System.Text.Json.Serialization;

namespace MrGoose.Backend;

// Mr Goose data model (fresh SQLite / EF Core). Mirrors the arena ground truth in
// reference/GROUND-TRUTH.md: challenges → scenarios → injection surfaces/markers,
// per-model break state, plus the prompt/technique libraries and selector profiles.

public class Challenge
{
    public int Id { get; set; }
    public string Slug { get; set; } = "";          // "ipi-black-2026"
    public string Name { get; set; } = "";
    public string World { get; set; } = "";
    public string Wave { get; set; } = "";
    public string Description { get; set; } = "";
    public int TotalBreaks { get; set; }
    public List<Scenario> Scenarios { get; set; } = new();
    public List<ModelAgent> Models { get; set; } = new();
}

public class Scenario
{
    public int Id { get; set; }
    public int ChallengeId { get; set; }
    [JsonIgnore] public Challenge? Challenge { get; set; }
    public string Code { get; set; } = "";          // "WB2S5"
    public string BehaviorId { get; set; } = "";     // "wb2s5-exfiltrate-customer-records"
    public string Name { get; set; } = "";
    public string Area { get; set; } = "";           // "white-box" | "black-box"
    public string HarmfulTask { get; set; } = "";
    public string BenignTask { get; set; } = "";
    public string Type { get; set; } = "ipi";         // ipi | direct
    public string Objective { get; set; } = "";
    public string Criteria { get; set; } = "";         // success criteria (both types)
    public string Reference { get; set; } = "";        // direct: reference/context material
    public string JudgeContext { get; set; } = "";     // direct: extra judge scoring context
    public string RequiredSurface { get; set; } = "";
    public string KnownWall { get; set; } = "";
    public int BreaksDone { get; set; }
    public int BreaksTotal { get; set; }
    public List<Surface> Surfaces { get; set; } = new();
    public List<Marker> Markers { get; set; } = new();
    public List<ReconNote> Recon { get; set; } = new();
}

public class Surface
{
    public int Id { get; set; }
    public int ScenarioId { get; set; }
    [JsonIgnore] public Scenario? Scenario { get; set; }
    public string Key { get; set; } = "";
    public string Label { get; set; } = "";
    public string Service { get; set; } = "";
    public string Action { get; set; } = "";
    public int MinInstances { get; set; }
    public int MaxInstances { get; set; }
    public bool HasSender { get; set; }
    public bool Required => MinInstances >= 1;
    public string FieldsCsv { get; set; } = "";       // field keys, for quick display
    public string SchemaJson { get; set; } = "";      // full JSON Schema (string)
}

public class Marker
{
    public int Id { get; set; }
    public int ScenarioId { get; set; }
    [JsonIgnore] public Scenario? Scenario { get; set; }
    public string Token { get; set; } = "";           // "{{attacker.email}}"
    public string Variable { get; set; } = "";
    public string Field { get; set; } = "";
    public string Type { get; set; } = "";
}

public class ReconNote
{
    public int Id { get; set; }
    public int ScenarioId { get; set; }
    [JsonIgnore] public Scenario? Scenario { get; set; }
    public string Category { get; set; } = "";
    public string Text { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class ModelAgent
{
    public int Id { get; set; }
    public int ChallengeId { get; set; }
    [JsonIgnore] public Challenge? Challenge { get; set; }
    public string Name { get; set; } = "";            // "White Elephant Supreme"
    public string Color { get; set; } = "";
    public int FieldBreaks { get; set; }              // cumulative across ALL waves, from page source
    public string WaveBreaksJson { get; set; } = "{}"; // per-wave break counts {"1":n,"2":n,"3":n} from page source
    public string Wave { get; set; } = "";             // manual wave assignment (for models with no breaks to auto-place)
    public List<ScenarioState> States { get; set; } = new();
}

/// <summary>An agent's full per-model×scenario harness dossier (ported from TENEBRIS JbScenarioState):
/// scaffold + tool namespace + browser flag, plus tools (with fired calls), filters/gates/system-tags
/// (as Facts, distinguished by Kind), the injection history, verdict and free notes.</summary>
public class ScenarioState
{
    public int Id { get; set; }
    public int ModelAgentId { get; set; }
    [JsonIgnore] public ModelAgent? Model { get; set; }
    public string ScenarioCode { get; set; } = "";
    public string Verdict { get; set; } = "untested"; // break | wall | partial | untested | na
    public string Dossier { get; set; } = "";         // free-text per model×scenario notes
    public string Scaffold { get; set; } = "";
    public string ToolNamespace { get; set; } = "";
    public bool Browser { get; set; }
    public List<DossierTool> Tools { get; set; } = new();
    public List<DossierFact> Facts { get; set; } = new();        // Kind: filter | gate | system_tag
    public List<DossierInjection> Injections { get; set; } = new();
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class DossierTool
{
    public int Id { get; set; }
    public int ScenarioStateId { get; set; }
    [JsonIgnore] public ScenarioState? State { get; set; }
    public string Name { get; set; } = "";
    public string Notation { get; set; } = "";       // call syntax skeleton
    public string ResultFormat { get; set; } = "";
    public string Note { get; set; } = "";
    public List<FiredCall> Calls { get; set; } = new();
}

public class FiredCall
{
    public int Id { get; set; }
    public int DossierToolId { get; set; }
    [JsonIgnore] public DossierTool? Tool { get; set; }
    public string Args { get; set; } = "";
    public string Result { get; set; } = "";
    public string Note { get; set; } = "";
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
}

public class DossierFact
{
    public int Id { get; set; }
    public int ScenarioStateId { get; set; }
    [JsonIgnore] public ScenarioState? State { get; set; }
    public string Kind { get; set; } = "filter";     // filter | gate | system_tag
    public string Name { get; set; } = "";
    public string Detail { get; set; } = "";
    public string Status { get; set; } = "confirmed"; // confirmed | suspected | refuted
}

public class DossierInjection
{
    public int Id { get; set; }
    public int ScenarioStateId { get; set; }
    [JsonIgnore] public ScenarioState? State { get; set; }
    public string Name { get; set; } = "";
    public string Surface { get; set; } = "";
    public string Techniques { get; set; } = "";     // csv
    public string Payload { get; set; } = "";
    public string Verdict { get; set; } = "untested"; // break | wall | partial | untested
    public string FlaggedBy { get; set; } = "";
    public DateTimeOffset Date { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>A reusable payload building block for the attacker picker (scaffold / escape / closer…).</summary>
public class BuildingBlock
{
    public int Id { get; set; }
    public string Type { get; set; } = "";
    public string Content { get; set; } = "";
}

/// <summary>A direct-jailbreak hunt (= TENEBRIS Finder session): one objective × victim model with its
/// transcript, judge-scored. No injection surfaces/markers — this is the direct-attack mode.</summary>
public class ChatSession
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string ChallengeSlug { get; set; } = "";
    public string ScenarioCode { get; set; } = "";      // the linked direct behavior (optional)
    public string ModelName { get; set; } = "";          // victim model
    public string Objective { get; set; } = "";
    public string Criteria { get; set; } = "";
    public string Reference { get; set; } = "";
    public string JudgeContext { get; set; } = "";
    public int Threshold { get; set; } = 70;
    public string Memory { get; set; } = "";             // instructor strategy memory
    public string BestPromptsJson { get; set; } = "[]";  // [{payload,score}]
    public List<ChatTurn> Turns { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class ChatTurn
{
    public int Id { get; set; }
    public int ChatSessionId { get; set; }
    [JsonIgnore] public ChatSession? Session { get; set; }
    public string Role { get; set; } = "";              // instructor | victim | judge | system
    public string Content { get; set; } = "";
    public int? Score { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Prompt
{
    public int Id { get; set; }
    public int? FolderId { get; set; }                 // null = root
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string Tags { get; set; } = "";            // csv
    public string ScenarioCode { get; set; } = "";
    public string Surface { get; set; } = "";
    public string Markers { get; set; } = "";          // csv
    public string Source { get; set; } = "manual";     // manual | import | finder | agent
    public string Verdict { get; set; } = "untested";
    public string FollowUpsJson { get; set; } = "[]";   // multi-shot follow-up turns (JSON string[])
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>A folder in the Prompt Library tree (self-referential parent).</summary>
public class PromptFolder
{
    public int Id { get; set; }
    public int? ParentId { get; set; }
    public string Name { get; set; } = "";
}

public class Technique
{
    public int Id { get; set; }
    public string Slug { get; set; } = "";             // stable id for built-ins (e.g. "tech-roleplay"); "" for user-added
    public string Title { get; set; } = "";
    public string Summary { get; set; } = "";
    public string WhenItWorks { get; set; } = "";
    public string Example { get; set; } = "";
    public string Tags { get; set; } = "";             // csv of TechniqueTag.Key
    public bool Builtin { get; set; }                   // seeded catalog entry (badge + reset target)
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Color-coded tag in the technique tag registry (ported from the TENEBRIS tag editor).</summary>
public class TechniqueTag
{
    public int Id { get; set; }
    public string Key { get; set; } = "";              // "direct", "encoding", "wave2"…
    public string Color { get; set; } = "#6b7280";     // hex chip color
    public string Description { get; set; } = "";
}

public class SelectorProfile
{
    public int Id { get; set; }
    public string ChallengeSlug { get; set; } = "";
    public string Name { get; set; } = "";
    public string SelectorsJson { get; set; } = "{}";  // { key: cssSelector }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Simple key/value app settings (OpenRouter key + model, etc.).</summary>
public class AppSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

/// <summary>A named OpenRouter API key, encrypted at rest with Windows DPAPI (CurrentUser). The operator
/// can store several and pick the active one. The plaintext is never returned by the API.</summary>
public class OpenRouterKey
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Secret { get; set; } = "";       // DPAPI-protected (prefixed), never returned raw
    public bool Active { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>A saved research source: an external link with a description, shown in the Source Library.</summary>
public class SourceLink
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Url { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>A saved research document (PDF / text). Data holds the raw file for viewing; Text holds the
/// extracted plain text the organizer agent reads (e.g. to extract techniques from a PDF).</summary>
public class SourceDoc
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";        // pdf | txt | md | json | csv
    public string Description { get; set; } = "";
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public string Text { get; set; } = "";
    public long Size { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>An operator-maintained fact/note appended to the Mr Goose Organizer's system prompt (its
/// knowledge base). The agent can also read/write these via its knowledge tools.</summary>
public class KnowledgeNote
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Content { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class Submission
{
    public int Id { get; set; }
    public string ExternalId { get; set; } = "";
    public string ChatId { get; set; } = "";
    public string ScenarioCode { get; set; } = "";
    public string ModelName { get; set; } = "";
    public string PayloadJson { get; set; } = "";
    public string Status { get; set; } = "";
    public bool IsBreak { get; set; }
    public DateTimeOffset SubmittedAt { get; set; }
}
