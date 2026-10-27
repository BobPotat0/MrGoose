// Shared types + the global shape the Electron preload injects as window.mrgoose.

export interface ChallengeSummary { slug: string; name: string; wave: string; world: string; totalBreaks: number; scenarios: number; models: number; }

export interface ChallengeDetail {
  slug: string; name: string; wave: string; world: string; totalBreaks: number;
  scenarios: ScenarioDto[]; models: ModelDto[];
}
export interface ScenarioDto {
  id: number; code: string; behaviorId: string; name: string; area: string; type: string;
  harmfulTask: string; benignTask: string; objective: string; criteria: string;
  reference: string; judgeContext: string;
  requiredSurface: string; knownWall: string; breaksDone: number; breaksTotal: number;
  surfaces: SurfaceDto[]; markers: MarkerDto[]; recon: ReconDto[];
}
export interface SurfaceDto { key: string; label: string; service: string; action: string; minInstances: number; maxInstances: number; hasSender: boolean; required: boolean; fieldsCsv: string; schemaJson: string; }
export interface MarkerDto { token: string; variable: string; field: string; type: string; }
export interface ReconDto { id: number; category: string; text: string; }
export interface ModelDto { id: number; name: string; color: string; fieldBreaks: number; waveBreaksJson: string; wave: string; states: StateDto[]; }
export interface StateDto { scenarioCode: string; verdict: string; dossier: string; }

export interface PromptDto { id: number; folderId: number | null; title: string; body: string; tags: string; scenarioCode: string; surface: string; markers: string; source: string; verdict: string; followUpsJson: string; createdAt: string; }
export interface FolderDto { id: number; parentId: number | null; name: string; }
export interface TechniqueDto { id: number; slug: string; title: string; summary: string; whenItWorks: string; example: string; tags: string; builtin: boolean; }
export interface TechniqueTagDto { id: number; key: string; color: string; description: string; }
export interface EncodingTransform { key: string; name: string; category: string; }
export interface SubmissionDto { id: number; externalId: string; scenarioCode: string; modelName: string; payloadJson: string; status: string; isBreak: boolean; submittedAt: string; }
export interface SettingsDto { model: string; hasKey: boolean; arenaUrl: string; }
export interface KeyInfo { id: number; name: string; active: boolean; last4: string; }
export interface ModelInfo { id: string; name: string; prompt: string; completion: string; }
export interface UsageInfo { hasKey: boolean; spentToday: number | null; balance: number | null; }
export interface KnowledgeNote { id: number; title: string; content: string; }
export interface OrganizerDoc { name: string; content: string; isCustom?: boolean; }
export interface OrganizerSystem { prompt: string; isCustom: boolean; default: string; }

export interface DossierState {
  id: number; scenarioCode: string; verdict: string; dossier: string;
  scaffold: string; toolNamespace: string; browser: boolean;
  tools: DossierTool[]; facts: DossierFact[]; injections: DossierInjection[];
}
export interface DossierTool { id: number; name: string; notation: string; resultFormat: string; note: string; calls: FiredCall[]; }
export interface FiredCall { id: number; args: string; result: string; note: string; }
export interface DossierFact { id: number; kind: string; name: string; detail: string; status: string; }
export interface DossierInjection { id: number; name: string; surface: string; techniques: string; payload: string; verdict: string; flaggedBy: string; }
export interface BuildingBlockDto { id: number; type: string; content: string; }
export interface BreakItem { id: string; label: string; payload: string; techniques: string; }
export interface PromptSelection { scenarioCode: string; modelName: string; techniqueIds: number[]; blockIds: number[]; breakIds: string[]; includeRecon: boolean; }

export interface FinderSummary { id: number; name: string; modelName: string; objective: string; threshold: number; turns: number; best: number; updatedAt: string; }
export interface ChatTurnDto { id: number; role: string; content: string; score: number | null; createdAt: string; }
export interface ChatSessionDto {
  id: number; name: string; challengeSlug: string; scenarioCode: string; modelName: string;
  objective: string; criteria: string; reference: string; judgeContext: string;
  threshold: number; memory: string; bestPromptsJson: string; turns: ChatTurnDto[];
}
export interface JudgeResult { score: number; rationale: string; }

export interface ArenaTab { id: string; url: string; title: string; active: boolean; }
export interface BridgeResult { ok: boolean; note?: string; text?: string; selector?: string; }

export interface MrGooseApi {
  backendUrl: string;
  backendToken?: string;
  mcp?: {
    status(): Promise<{ profiles: unknown[]; enabled: boolean; command: string; args: string[]; env: Record<string, string> }>;
    saveProfile(profile: unknown): Promise<void>;
  };
  openUrl?(url: string): Promise<boolean>;
  tabs: {
    create(url?: string): Promise<string>;
    select(id: string): Promise<ArenaTab[]>;
    close(id: string): Promise<ArenaTab[]>;
    list(): Promise<ArenaTab[]>;
    show?(): Promise<void>;
    onChanged?: (callback: (tabs: ArenaTab[]) => void) => () => void;
    loadUrl(id: string, url: string): Promise<boolean>;
    setBounds(rect: { x: number; y: number; width: number; height: number }): Promise<boolean>;
    setVisible(visible: boolean): Promise<boolean>;
    detach?: () => Promise<{ docked: boolean }>;
    dock?: () => Promise<{ docked: boolean }>;
    state?: () => Promise<{ docked: boolean }>;
    onDocked?: (callback: (s: { docked: boolean }) => void) => () => void;
  };
  bridge: {
    fillField(tabId: string, selector: string, value: string): Promise<BridgeResult>;
    readDom(tabId: string, selector: string): Promise<BridgeResult>;
    snapshotConversation(tabId: string, selector?: string): Promise<BridgeResult>;
    highlightSendButton(tabId: string, selector: string): Promise<BridgeResult>;
    pickElement(tabId: string): Promise<BridgeResult>;
  };
}

declare global {
  interface Window { mrgoose?: MrGooseApi; }
}

export interface OrganizerFileInfo { id: string; name: string; size: number; createdAt: string; source?: 'agent' | 'upload'; }
export interface OrganizerFileContent { file: OrganizerFileInfo; content: string; }

export interface SourceLinkDto { id: number; title: string; url: string; description: string; createdAt: string; }
export interface SourceDocDto { id: number; name: string; type: string; description: string; size: number; hasText: boolean; createdAt: string; }
