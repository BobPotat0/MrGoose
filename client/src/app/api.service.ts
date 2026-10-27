import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ChallengeSummary, ChallengeDetail, PromptDto, TechniqueDto, TechniqueTagDto, EncodingTransform,
  SubmissionDto, SettingsDto, DossierState, BuildingBlockDto, BreakItem, PromptSelection,
  ScenarioDto, FinderSummary, ChatSessionDto, ChatTurnDto, JudgeResult, FolderDto,
  KnowledgeNote, OrganizerDoc, OrganizerSystem, KeyInfo, ModelInfo, UsageInfo, OrganizerFileInfo, OrganizerFileContent,
  SourceLinkDto, SourceDocDto,
} from './models';

/** Typed REST wrapper over the C# backend. Methods return Promises for easy async/await in pages. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = window.mrgoose?.backendUrl ?? 'http://127.0.0.1:5174';
  private url(p: string) { return `${this.base}${p}`; }

  organizerFiles(sessionId: string) { return firstValueFrom(this.http.get<OrganizerFileInfo[]>(this.url(`/api/organizer/sessions/${encodeURIComponent(sessionId)}/files`))); }
  uploadOrganizerFile(sessionId: string, file: File) { const form = new FormData(); form.append('file', file); return firstValueFrom(this.http.post<OrganizerFileInfo>(this.url(`/api/organizer/sessions/${encodeURIComponent(sessionId)}/files`), form)); }
  organizerFile(sessionId: string, id: string) { return firstValueFrom(this.http.get<OrganizerFileContent>(this.url(`/api/organizer/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(id)}`))); }
  organizerFileDownload(sessionId: string, id: string) { return firstValueFrom(this.http.get(this.url(`/api/organizer/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(id)}/download`), { responseType: 'blob' })); }
  deleteOrganizerFiles(sessionId: string) { return firstValueFrom(this.http.delete(this.url(`/api/organizer/sessions/${encodeURIComponent(sessionId)}/files`))); }
  updateOrganizerFile(sessionId: string, id: string, content: string) { return firstValueFrom(this.http.put(this.url(`/api/organizer/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(id)}`), { content })); }

  challenges() { return firstValueFrom(this.http.get<ChallengeSummary[]>(this.url('/api/challenges'))); }
  challenge(slug: string) { return firstValueFrom(this.http.get<ChallengeDetail>(this.url(`/api/challenges/${slug}`))); }

  prompts(scenario?: string) {
    const q = scenario ? `?scenario=${encodeURIComponent(scenario)}` : '';
    return firstValueFrom(this.http.get<PromptDto[]>(this.url(`/api/prompts${q}`)));
  }
  addPrompt(p: Partial<PromptDto>) { return firstValueFrom(this.http.post<PromptDto>(this.url('/api/prompts'), p)); }
  updatePrompt(id: number, p: Partial<PromptDto>) { return firstValueFrom(this.http.put<PromptDto>(this.url(`/api/prompts/${id}`), p)); }
  deletePrompt(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/prompts/${id}`))); }

  // prompt folders + import/export + ai-edit + encode
  folders() { return firstValueFrom(this.http.get<FolderDto[]>(this.url('/api/folders'))); }
  addFolder(name: string, parentId: number | null) { return firstValueFrom(this.http.post<FolderDto>(this.url('/api/folders'), { name, parentId })); }
  renameFolder(id: number, name: string, parentId: number | null) { return firstValueFrom(this.http.put(this.url(`/api/folders/${id}`), { name, parentId })); }
  deleteFolder(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/folders/${id}`))); }
  exportPrompts() { return firstValueFrom(this.http.get<{ folders: FolderDto[]; prompts: PromptDto[] }>(this.url('/api/prompts/export'))); }
  importPrompts(data: { folders: FolderDto[]; prompts: PromptDto[] }) { return firstValueFrom(this.http.post<any>(this.url('/api/prompts/import'), data)); }
  duplicatePrompt(id: number) { return firstValueFrom(this.http.post<PromptDto>(this.url(`/api/prompts/${id}/duplicate`), {})); }
  aiEdit(body: string, instruction: string) { return firstValueFrom(this.http.post<{ result: string; error?: string }>(this.url('/api/prompts/ai-edit'), { body, instruction })); }
  encodeSchemes() { return firstValueFrom(this.http.get<string[]>(this.url('/api/encode/schemes'))); }
  encodeCatalog() { return firstValueFrom(this.http.get<EncodingTransform[]>(this.url('/api/encode/catalog'))); }
  encode(scheme: string, text: string) { return firstValueFrom(this.http.post<{ result: string }>(this.url('/api/encode'), { scheme, text })); }
  encodeChain(keys: string[], text: string, marked = false) { return firstValueFrom(this.http.post<{ result: string }>(this.url('/api/encode'), { keys, text, marked })); }

  techniques() { return firstValueFrom(this.http.get<TechniqueDto[]>(this.url('/api/techniques'))); }
  addTechnique(t: Partial<TechniqueDto>) { return firstValueFrom(this.http.post<TechniqueDto>(this.url('/api/techniques'), t)); }
  updateTechnique(id: number, t: Partial<TechniqueDto>) { return firstValueFrom(this.http.put<TechniqueDto>(this.url(`/api/techniques/${id}`), t)); }
  deleteTechnique(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/techniques/${id}`))); }
  resetTechniques() { return firstValueFrom(this.http.post<{ written: number }>(this.url('/api/techniques/reset'), {})); }
  exportTechniques() { return firstValueFrom(this.http.get<TechniqueDto[]>(this.url('/api/techniques/export'))); }
  importTechniques(items: TechniqueDto[]) { return firstValueFrom(this.http.post<{ imported: number }>(this.url('/api/techniques/import'), items)); }
  techniqueTags() { return firstValueFrom(this.http.get<TechniqueTagDto[]>(this.url('/api/technique-tags'))); }
  saveTechniqueTag(t: Partial<TechniqueTagDto>) { return firstValueFrom(this.http.post(this.url('/api/technique-tags'), t)); }
  deleteTechniqueTag(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/technique-tags/${id}`))); }

  submissions() { return firstValueFrom(this.http.get<SubmissionDto[]>(this.url('/api/submissions'))); }

  setState(dto: { slug: string; model: string; scenarioCode: string; verdict: string; dossier?: string }) {
    return firstValueFrom(this.http.put(this.url('/api/states'), dto));
  }
  setModelWave(id: number, wave: string) { return firstValueFrom(this.http.put(this.url(`/api/models/${id}/wave`), { wave })); }
  addRecon(code: string, dto: { category?: string; text: string }) {
    return firstValueFrom(this.http.post(this.url(`/api/scenarios/${code}/recon`), dto));
  }
  delRecon(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/recon/${id}`))); }

  // attacker + dossier
  systemPrompt(sel: PromptSelection) { return firstValueFrom(this.http.post<{ prompt: string }>(this.url('/api/craft/system-prompt'), sel)); }
  dossier(model: string, scenario: string) {
    return firstValueFrom(this.http.get<DossierState>(this.url(`/api/dossier?model=${encodeURIComponent(model)}&scenario=${encodeURIComponent(scenario)}`)));
  }
  dossierMeta(dto: { model: string; scenario: string; scaffold?: string; toolNamespace?: string; browser?: boolean }) {
    return firstValueFrom(this.http.put(this.url('/api/dossier/meta'), dto));
  }
  dossierRecord(model: string, scenario: string, tool: string, args: object) {
    return firstValueFrom(this.http.post<{ result: string }>(this.url('/api/dossier/record'), { model, scenario, tool, args: JSON.stringify(args) }));
  }
  delFact(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/dossier/fact/${id}`))); }
  delTool(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/dossier/tool/${id}`))); }
  delInjection(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/dossier/injection/${id}`))); }
  buildingBlocks() { return firstValueFrom(this.http.get<BuildingBlockDto[]>(this.url('/api/building-blocks'))); }
  breaks() { return firstValueFrom(this.http.get<BreakItem[]>(this.url('/api/breaks'))); }
  updateMarkers(code: string, tokens: string[]) { return firstValueFrom(this.http.put(this.url(`/api/scenarios/${code}/markers`), tokens)); }

  // challenges + objectives authoring
  createChallenge(c: { slug: string; name: string; world?: string; wave?: string; description?: string }) { return firstValueFrom(this.http.post(this.url('/api/challenges'), c)); }
  addScenario(slug: string, s: Partial<ScenarioDto>) { return firstValueFrom(this.http.post<ScenarioDto>(this.url(`/api/challenges/${slug}/scenarios`), s)); }
  updateScenario(id: number, s: Partial<ScenarioDto>) { return firstValueFrom(this.http.put<ScenarioDto>(this.url(`/api/scenarios/${id}`), s)); }
  deleteScenario(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/scenarios/${id}`))); }

  // finder (direct-jailbreak) sessions
  finderSessions() { return firstValueFrom(this.http.get<FinderSummary[]>(this.url('/api/finder/sessions'))); }
  createFinderSession(s: Partial<ChatSessionDto>) { return firstValueFrom(this.http.post<ChatSessionDto>(this.url('/api/finder/sessions'), s)); }
  finderSession(id: number) { return firstValueFrom(this.http.get<ChatSessionDto>(this.url(`/api/finder/sessions/${id}`))); }
  updateFinderSession(id: number, s: Partial<ChatSessionDto>) { return firstValueFrom(this.http.put(this.url(`/api/finder/sessions/${id}`), s)); }
  deleteFinderSession(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/finder/sessions/${id}`))); }
  addTurn(id: number, turn: Partial<ChatTurnDto>) { return firstValueFrom(this.http.post<ChatTurnDto>(this.url(`/api/finder/sessions/${id}/turns`), turn)); }
  judge(sessionId: number, reply: string) { return firstValueFrom(this.http.post<JudgeResult>(this.url('/api/finder/judge'), { sessionId, reply })); }
  judgeDirect(objective: string, criteria: string, reply: string, judgeContext = '') { return firstValueFrom(this.http.post<JudgeResult>(this.url('/api/judge-direct'), { objective, criteria, judgeContext, reply })); }

  // mr goose agent: system prompt + knowledge base
  organizerSystem() { return firstValueFrom(this.http.get<OrganizerSystem>(this.url('/api/organizer/system'))); }
  setOrganizerSystem(prompt: string) { return firstValueFrom(this.http.put(this.url('/api/organizer/system'), { prompt })); }
  resetOrganizerSystem() { return firstValueFrom(this.http.delete<{ prompt: string }>(this.url('/api/organizer/system'))); }
  organizerDocs() { return firstValueFrom(this.http.get<OrganizerDoc[]>(this.url('/api/organizer/docs'))); }
  saveDoc(name: string, content: string) { return firstValueFrom(this.http.put(this.url('/api/organizer/docs'), { name, content })); }
  resetDoc(name: string) { return firstValueFrom(this.http.delete(this.url(`/api/organizer/docs/${encodeURIComponent(name)}`))); }
  resetDocs() { return firstValueFrom(this.http.post(this.url('/api/organizer/docs/reset'), {})); }
  setOrganizerSession(sessionId: string) { return firstValueFrom(this.http.put(this.url('/api/organizer/active-session'), { sessionId })); }
  knowledge() { return firstValueFrom(this.http.get<KnowledgeNote[]>(this.url('/api/knowledge'))); }
  addKnowledge(n: Partial<KnowledgeNote>) { return firstValueFrom(this.http.post<KnowledgeNote>(this.url('/api/knowledge'), n)); }
  updateKnowledge(id: number, n: Partial<KnowledgeNote>) { return firstValueFrom(this.http.put<KnowledgeNote>(this.url(`/api/knowledge/${id}`), n)); }
  deleteKnowledge(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/knowledge/${id}`))); }

  settings() { return firstValueFrom(this.http.get<SettingsDto>(this.url('/api/settings'))); }
  setSetting(key: string, value: string) { return firstValueFrom(this.http.put(this.url('/api/settings'), { key, value })); }

  // openrouter keys (DPAPI) + model search + usage
  keys() { return firstValueFrom(this.http.get<KeyInfo[]>(this.url('/api/keys'))); }
  addKey(name: string, value: string) { return firstValueFrom(this.http.post<{ id: number }>(this.url('/api/keys'), { name, value })); }
  activateKey(id: number) { return firstValueFrom(this.http.put(this.url(`/api/keys/${id}/activate`), {})); }
  deleteKey(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/keys/${id}`))); }
  models(q: string) { return firstValueFrom(this.http.get<ModelInfo[]>(this.url(`/api/models?q=${encodeURIComponent(q)}`))); }
  usage() { return firstValueFrom(this.http.get<UsageInfo>(this.url('/api/usage'))); }

  // source library — research links + documents (PDF/text)
  sourceLinks() { return firstValueFrom(this.http.get<SourceLinkDto[]>(this.url('/api/sources/links'))); }
  addSourceLink(l: Partial<SourceLinkDto>) { return firstValueFrom(this.http.post<SourceLinkDto>(this.url('/api/sources/links'), l)); }
  updateSourceLink(id: number, l: Partial<SourceLinkDto>) { return firstValueFrom(this.http.put<SourceLinkDto>(this.url(`/api/sources/links/${id}`), l)); }
  deleteSourceLink(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/sources/links/${id}`))); }
  sourceDocs() { return firstValueFrom(this.http.get<SourceDocDto[]>(this.url('/api/sources/docs'))); }
  uploadSourceDoc(file: File, description = '') { const fd = new FormData(); fd.append('file', file); fd.append('description', description); return firstValueFrom(this.http.post<SourceDocDto>(this.url('/api/sources/docs'), fd)); }
  sourceDocContent(id: number) { return firstValueFrom(this.http.get(this.url(`/api/sources/docs/${id}/content`), { responseType: 'blob' })); }
  sourceDocText(id: number) { return firstValueFrom(this.http.get<{ id: number; name: string; type: string; description: string; text: string }>(this.url(`/api/sources/docs/${id}/text`))); }
  deleteSourceDoc(id: number) { return firstValueFrom(this.http.delete(this.url(`/api/sources/docs/${id}`))); }

  importZip(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return firstValueFrom(this.http.post<any>(this.url('/api/import/zip'), fd));
  }
  importPageSource(html: string) {
    return firstValueFrom(this.http.post<any>(this.url('/api/import/page-source'), html, {
      headers: { 'Content-Type': 'text/plain' },
    }));
  }
}
