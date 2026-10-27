import { Component, ElementRef, ViewChild, WritableSignal, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { BackendService, ChatMsg } from '../backend.service';
import { ArenaService } from '../arena.service';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { ArenaPaneComponent } from '../arena-pane';
import {
  ChallengeDetail, ChallengeSummary, ModelDto, ScenarioDto, DossierState, DossierFact,
  TechniqueDto, BuildingBlockDto, MarkerDto, PromptSelection, EncodingTransform, PromptDto, ReconDto,
} from '../models';

type Tab = 'overview' | 'analyze' | 'attack';
type AStep = 'craft' | 'fill' | 'launch' | 'read' | 'record';
type Overlay = '' | 'blocks' | 'breaks' | 'techs' | 'tools' | 'markers' | 'prompt' | 'enc';
type ViewItem = { type: 'user' | 'assistant' | 'tool'; text: string; reasoning?: string; reasoningOpen?: boolean };
const ORDER = ['untested', 'break', 'wall', 'partial', 'na'];

@Component({
  selector: 'mg-workbench',
  imports: [FormsModule, ArenaPaneComponent],
  templateUrl: './workbench.html',
  styleUrl: './workbench.css',
})
export class WorkbenchPage {
  backend = inject(BackendService);
  arena = inject(ArenaService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  slug = 'ipi-black-2026';
  readonly challengeList = signal<ChallengeSummary[]>([]);

  readonly attackSteps: AStep[] = ['craft', 'fill', 'launch', 'read', 'record'];
  readonly aStep = signal<AStep>('craft');

  readonly tab = signal<Tab>('overview');
  readonly detail = signal<ChallengeDetail | null>(null);
  readonly open = signal<Set<string>>(new Set());
  readonly dossier = signal<DossierState | null>(null);

  readonly techniques = signal<TechniqueDto[]>([]);
  readonly blocks = signal<BuildingBlockDto[]>([]);
  readonly promptRefs = signal<PromptDto[]>([]);
  readonly markers = signal<MarkerDto[]>([]);
  readonly selTechs = signal<Set<number>>(new Set());
  readonly selBlocks = signal<Set<number>>(new Set());
  readonly selBreaks = signal<Set<string>>(new Set());
  readonly overlay = signal<Overlay>('');

  readonly view = signal<ViewItem[]>([]);
  readonly streaming = signal(false);
  readonly crafted = signal('');
  readonly victim = signal('');
  readonly catalog = signal<EncodingTransform[]>([]);
  readonly encKeys = signal<string[]>([]);
  readonly importing = signal(false);
  readonly importStatus = signal('');
  pageSrc = '';
  readonly arenaPct = signal(58);
  @ViewChild('ws') wsRef?: ElementRef<HTMLElement>;

  scenarioCode = 'WB2S4';
  modelName = '';
  includeRecon = true;
  encMarked = false;
  input = ''; fillSel = '#chatTextarea'; newMarker = ''; promptDraft = ''; breakSearch = '';
  scaffold = ''; toolNs = ''; browser = false;
  factKind = 'filter'; factName = ''; factDetail = '';
  reconCat = ''; reconText = '';
  private convo: ChatMsg[] = [];

  readonly scenarios = computed(() => this.detail()?.scenarios ?? []);
  readonly ipiScenarios = computed(() => this.scenarios().filter(s => s.type === 'ipi'));
  readonly models = computed(() => [...(this.detail()?.models ?? [])].sort((a, b) => b.fieldBreaks - a.fieldBreaks || a.name.localeCompare(b.name)));
  readonly waveFilter = signal<'all' | '1' | '2' | '3' | ''>('all');
  readonly sortKey = signal<string>('field');   // 'model' | 'field' | 'my' | 'wave' | a scenario code
  readonly sortDir = signal<1 | -1>(-1);
  sortBy(key: string) {
    if (this.sortKey() === key) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else { this.sortKey.set(key); this.sortDir.set(key === 'model' || key === 'wave' ? 1 : -1); }
  }
  sortArrow(key: string): string { return this.sortKey() === key ? (this.sortDir() === 1 ? '▲' : '▼') : ''; }
  private sortVal(m: ModelDto, key: string): number | string {
    if (key === 'model') return m.name.toLowerCase();
    if (key === 'field') return m.fieldBreaks;
    if (key === 'my') return this.myBreaks(m);
    if (key === 'wave') return m.wave || '';
    return ({ break: 3, partial: 2, wall: 1 } as Record<string, number>)[this.verdictOf(m, key)] ?? 0;   // scenario column
  }
  // ALL models, filtered by manually-assigned wave, sorted by the clicked column
  rows(): ModelDto[] {
    const f = this.waveFilter(), k = this.sortKey(), d = this.sortDir();
    return [...(this.detail()?.models ?? [])]
      .filter(m => f === 'all' || (m.wave || '') === f)
      .sort((a, b) => {
        const va = this.sortVal(a, k), vb = this.sortVal(b, k);
        const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return (c * d) || a.name.localeCompare(b.name);
      });
  }
  myBreaks(m: ModelDto): number { return this.ipiScenarios().filter(s => this.verdictOf(m, s.code) === 'break').length; }
  assignedWaves(): string[] { return [...new Set((this.detail()?.models ?? []).map(m => m.wave).filter(w => !!w))].sort(); }
  modelsOfWave(w: string): ModelDto[] { return [...(this.detail()?.models ?? [])].filter(m => m.wave === w).sort((a, b) => b.fieldBreaks - a.fieldBreaks || a.name.localeCompare(b.name)); }
  async setModelWave(m: ModelDto, wave: string) {
    m.wave = wave;   // optimistic (the <select> is one-way bound)
    await this.api.setModelWave(m.id, wave);
    this.detail.set(await this.api.challenge(this.slug));
    this.toast.ok(`${m.name} → ${wave ? 'Wave ' + wave : 'unassigned'}`);
  }

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('scenario')) this.scenarioCode = q.get('scenario')!;
    if (q.get('model')) { this.modelName = q.get('model')!; this.tab.set('attack'); }
    this.load();
  }
  async load() {
    try {
      this.challengeList.set(await this.api.challenges());
      if (!this.challengeList().some(c => c.slug === this.slug)) this.slug = this.challengeList()[0]?.slug ?? this.slug;
      const c = await this.api.challenge(this.slug);
      this.detail.set(c);
      this.modelName ||= this.models()[0]?.name ?? '';
      this.techniques.set(await this.api.techniques());
      this.blocks.set(await this.api.buildingBlocks());
      this.promptRefs.set(await this.api.prompts());
      this.catalog.set(await this.api.encodeCatalog());
      await this.onSelect();
    } catch { /* backend down */ }
  }
  async onSelect() {
    this.markers.set(this.scenarios().find(s => s.code === this.scenarioCode)?.markers ?? []);
    if (this.modelName && this.scenarioCode) {
      const d = await this.api.dossier(this.modelName, this.scenarioCode);
      this.dossier.set(d); this.scaffold = d.scaffold; this.toolNs = d.toolNamespace; this.browser = d.browser;
    }
  }
  openAttack(model: string, code: string) { this.modelName = model; this.scenarioCode = code; this.aStep.set('craft'); this.tab.set('attack'); this.onSelect(); }
  async onChallenge(slug: string) {
    this.slug = slug;
    this.detail.set(await this.api.challenge(slug));
    this.modelName = this.models()[0]?.name ?? '';
    this.scenarioCode = this.ipiScenarios()[0]?.code ?? this.scenarios()[0]?.code ?? '';
    await this.onSelect();
  }

  // overview
  async importPage() {
    if (!this.pageSrc.trim()) return;
    this.importing.set(true);
    try {
      const r = await this.api.importPageSource(this.pageSrc);
      this.importStatus.set((r?.notes ?? []).join(' · '));
      this.pageSrc = '';
      this.detail.set(await this.api.challenge(this.slug));
      this.modelName = this.models()[0]?.name ?? this.modelName;
      await this.onSelect();
      this.toast.ok('page source imported');
    } catch { this.toast.err('import failed'); }
    this.importing.set(false);
  }
  toggle(code: string) { const s = new Set(this.open()); s.has(code) ? s.delete(code) : s.add(code); this.open.set(s); }
  verdictOf(m: ModelDto, code: string) { return m.states.find(s => s.scenarioCode === code)?.verdict ?? 'untested'; }
  sym(v: string) { return ({ break: '✓', wall: '✕', partial: '≈', na: '–' } as Record<string, string>)[v] ?? ''; }
  markerStr(s: ScenarioDto) { return s.markers.map(m => m.token).join('  '); }

  // recon
  factsOf(d: DossierState, kind: string): DossierFact[] { return d.facts.filter(f => f.kind === kind); }
  factCount(kind: string) { return this.dossier()?.facts.filter(f => f.kind === kind).length ?? 0; }
  reconNotes(): ReconDto[] { return this.scenarios().find(s => s.code === this.scenarioCode)?.recon ?? []; }
  async saveMeta() { await this.api.dossierMeta({ model: this.modelName, scenario: this.scenarioCode, scaffold: this.scaffold, toolNamespace: this.toolNs, browser: this.browser }); this.toast.ok('dossier saved'); }
  async addFact() {
    const tool = this.factKind === 'gate' ? 'record_gate' : this.factKind === 'system_tag' ? 'record_system_tag' : 'record_filter';
    await this.api.dossierRecord(this.modelName, this.scenarioCode, tool, { name: this.factName.trim(), detail: this.factDetail.trim() });
    this.factName = ''; this.factDetail = ''; await this.onSelect();
  }
  async addReconNote() { await this.api.addRecon(this.scenarioCode, { category: this.reconCat.trim(), text: this.reconText.trim() }); this.reconCat = ''; this.reconText = ''; this.detail.set(await this.api.challenge(this.slug)); }
  async delReconNote(id: number) { await this.api.delRecon(id); this.detail.set(await this.api.challenge(this.slug)); }
  async delFact(id: number) { await this.api.delFact(id); await this.onSelect(); }
  async delTool(id: number) { await this.api.delTool(id); await this.onSelect(); }

  // overlays
  overlayTitle() { return ({ breaks: '🎯 Break from prompt library as reference', blocks: '🧩 Building blocks', techs: '⚔ Techniques', tools: '🛠 Tool calls / forge', markers: '✎ Markers', prompt: '👁 System prompt', enc: '🔡 Payload encoder' } as Record<string, string>)[this.overlay()] ?? ''; }
  openOverlay(o: Overlay) { this.overlay.set(o); this.arena.setVisible(false); }
  closeOverlay() { this.overlay.set(''); this.arena.setVisible(true); }
  filteredBreakRefs(): PromptDto[] {
    const q = this.breakSearch.trim().toLowerCase();
    return [...this.promptRefs()]
      .filter(p => !q || `${p.title} ${p.tags} ${p.body}`.toLowerCase().includes(q))
      .sort((a, b) => (b.verdict === 'break' ? 1 : 0) - (a.verdict === 'break' ? 1 : 0));
  }

  // encoder
  encCategories(): string[] { return [...new Set(this.catalog().map(t => t.category))]; }
  encByCat(cat: string): EncodingTransform[] { return this.catalog().filter(t => t.category === cat); }
  toggleEnc(key: string) { const a = [...this.encKeys()]; const i = a.indexOf(key); i >= 0 ? a.splice(i, 1) : a.push(key); this.encKeys.set(a); }
  // tool-call picker / forge
  insertToolCall(notation: string) { this.insert(notation); this.closeOverlay(); this.toast.ok('inserted into message'); }
  forgeResult(name: string) { this.insert(`\n\n${name}(…) => {\n  "result": "FORGED — replace with the result you want the victim to believe"\n}`); this.closeOverlay(); this.toast.ok('forged tool-result block inserted — edit it in the message box'); }
  pick<T>(sig: WritableSignal<Set<T>>, id: T) { const s = new Set(sig()); s.has(id) ? s.delete(id) : s.add(id); sig.set(s); }
  insert(t: string) { this.input = (this.input ? this.input + ' ' : '') + t; }
  async addMarker() { await this.api.updateMarkers(this.scenarioCode, [...this.markers().map(m => m.token), this.newMarker.trim()]); this.newMarker = ''; await this.reloadMarkers(); }
  async removeMarker(t: string) { await this.api.updateMarkers(this.scenarioCode, this.markers().map(m => m.token).filter(x => x !== t)); await this.reloadMarkers(); }
  private async reloadMarkers() { const c = await this.api.challenge(this.slug); this.detail.set(c); this.markers.set(this.scenarios().find(s => s.code === this.scenarioCode)?.markers ?? []); }

  // arena resize
  startDrag(ev: MouseEvent) {
    ev.preventDefault();
    const ws = this.wsRef?.nativeElement; if (!ws) return;
    const rect = ws.getBoundingClientRect();
    const move = (e: MouseEvent) => { let pct = ((e.clientX - rect.left) / rect.width) * 100; pct = Math.max(25, Math.min(80, pct)); this.arenaPct.set(pct); };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  }

  private selection(): PromptSelection { return { scenarioCode: this.scenarioCode, modelName: this.modelName, techniqueIds: [...this.selTechs()], blockIds: [...this.selBlocks()], breakIds: [...this.selBreaks()], includeRecon: this.includeRecon }; }
  async openPrompt() { this.promptDraft = (await this.api.systemPrompt(this.selection())).prompt; this.openOverlay('prompt'); }
  async resyncPrompt() { this.promptDraft = (await this.api.systemPrompt(this.selection())).prompt; this.toast.ok('re-synced'); }

  async send() {
    if (this.streaming() || !this.input.trim()) return;
    const text = this.input.trim();
    this.convo.push({ role: 'user', content: text });
    this.view.update(v => [...v, { type: 'user', text }]);
    this.input = ''; this.streaming.set(true);
    const system = this.promptDraft.trim() ? this.promptDraft : (await this.api.systemPrompt(this.selection())).prompt;
    let buffer = '';
    await this.backend.sendChat(
      { scenarioCode: this.scenarioCode, modelName: this.modelName, systemPrompt: system, messages: this.convo },
      (tok) => { buffer += tok; this.appendAsst('text', tok); },
      (name, args) => this.view.update(v => [...v, { type: 'tool', text: `${name} ${this.short(args)}` }]),
      async () => { this.streaming.set(false); if (buffer) this.convo.push({ role: 'assistant', content: buffer }); this.crafted.set(this.extract(buffer)); await this.onSelect(); if (this.crafted()) this.aStep.set('fill'); },
      (tok) => this.appendAsst('reasoning', tok),
    );
  }
  private appendAsst(kind: 'text' | 'reasoning', tok: string) {
    this.view.update(v => {
      const a = [...v];
      let last = a[a.length - 1];
      if (!last || last.type !== 'assistant') { last = { type: 'assistant', text: '', reasoning: '' }; a.push(last); }
      else { last = { ...last }; a[a.length - 1] = last; }
      if (kind === 'text') last.text = (last.text || '') + tok; else last.reasoning = (last.reasoning || '') + tok;
      return a;
    });
  }
  toggleReasoning(i: number) { this.view.update(v => { const a = [...v]; if (a[i]) a[i] = { ...a[i], reasoningOpen: !a[i].reasoningOpen }; return a; }); }

  // loop stepper
  aIdx(s: AStep) { return this.attackSteps.indexOf(s); }
  aLabel(s: AStep) { return ({ craft: 'craft', fill: 'fill', launch: 'you launch', read: 'read back', record: 'record' } as Record<AStep, string>)[s]; }
  aRun(s: AStep) {
    if (s === 'fill') { this.fillIntoTab(); return; }
    if (s === 'read') { this.readBack(); return; }
    if (s === 'craft') { this.toast.info('Type a craft request (or paste a victim run) below, then send.'); return; }
    if (s === 'launch') { this.toast.info('Launch/submit the injection in the arena yourself, then ④ read back.'); return; }
    this.toast.info('Use break / wall / partial below to record the outcome.');
  }
  private extract(s: string) { const f = s.match(/\`\`\`[a-z]*\n([\s\S]*?)\`\`\`/i); return (f ? f[1] : s).trim(); }
  private lastPayload() { const l = [...this.view()].reverse().find(v => v.type === 'assistant'); return l ? this.extract(l.text) : ''; }

  onPick(selector: string) { this.fillSel = selector; this.toast.ok(`fill target set → ${selector}`); }
  async fillIntoTab() {
    let p = this.lastPayload(); if (!p) { this.toast.err('nothing crafted yet'); return; }
    const enc = this.encKeys().length > 0 || this.encMarked;
    if (enc) p = (await this.api.encodeChain(this.encKeys(), p, this.encMarked)).result;
    const r = await this.arena.fill(this.fillSel, p);
    if (r.ok) { this.aStep.set('launch'); this.toast.ok(`filled${enc ? ' (' + (this.encKeys().join('→') || 'marked') + ')' : ''} — review, then launch/submit in the arena yourself`); } else this.toast.err(r.note || 'fill failed');
  }
  async judge() {
    const scen = this.scenarios().find(s => s.code === this.scenarioCode);
    const reply = this.victim(); if (!reply) { this.toast.err('read back a reply first (④)'); return; }
    const res = await this.api.judgeDirect(scen?.objective ?? '', scen?.criteria ?? '', reply);
    if (res.score < 0) { this.toast.err(res.rationale); return; }
    if (res.score >= 70) { this.toast.ok(`judge ${res.score}: ${res.rationale} — recording break`); await this.record('break'); }
    else this.toast.info(`judge ${res.score}: ${res.rationale}`);
  }
  async readBack() {
    const r = await this.arena.snapshot();
    if (r.text) { this.victim.set(r.text); this.input = `Victim run:\n${r.text}`; this.aStep.set('record'); this.toast.ok('read back → send it to the crafter to analyse into the dossier'); }
    else this.toast.err(r.note || 'nothing read');
  }
  async record(v: string) {
    const p = this.lastPayload();
    const surface = this.scenarios().find(s => s.code === this.scenarioCode)?.requiredSurface ?? '';
    if (p) await this.api.dossierRecord(this.modelName, this.scenarioCode, 'record_injection', { name: 'crafted', surface, techniques: '', payload: p, verdict: v, flagged_by: 'operator' });
    await this.api.setState({ slug: this.slug, model: this.modelName, scenarioCode: this.scenarioCode, verdict: v });
    await this.onSelect();
    this.aStep.set('craft'); this.toast.ok(`recorded ${v}`);
  }
  short(s: string) { return (s ?? '').length > 80 ? s.slice(0, 80) + '…' : (s ?? ''); }
}
