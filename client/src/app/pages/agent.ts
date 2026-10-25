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
  template: `
    <section class="page" style="max-width:none">
      <header class="page-head">
        <span class="label-mono">Break Workbench</span>
        <h1>Break Workbench</h1>
        <div class="row" style="margin-top:10px">
          <button class="btn" [class.primary]="tab()==='overview'" (click)="tab.set('overview')">Overview</button>
          <button class="btn" [class.primary]="tab()==='analyze'" (click)="tab.set('analyze')">Recon</button>
          <button class="btn" [class.primary]="tab()==='attack'" (click)="tab.set('attack')">Find Break</button>
          <span class="grow"></span>
          @if (tab()!=='overview') {
            <select class="input" style="max-width:260px" [(ngModel)]="scenarioCode" (ngModelChange)="onSelect()">
              @for (s of scenarios(); track s.code) { <option [value]="s.code">{{ s.code }} — {{ s.name }}</option> }
            </select>
            <select class="input" style="max-width:200px" [(ngModel)]="modelName" (ngModelChange)="onSelect()">
              @for (m of models(); track m.id) { <option [value]="m.name">{{ m.name }}</option> }
            </select>
          }
        </div>
      </header>

      <!-- ───────── OVERVIEW ───────── -->
      @if (tab()==='overview') {
        <div class="card" style="margin-bottom:12px"><div class="row"><span class="label-mono">challenge</span>
          <select class="input" style="max-width:360px" [ngModel]="slug" (ngModelChange)="onChallenge($event)">@for (c of challengeList(); track c.slug) { <option [value]="c.slug">{{ c.name }} ({{ c.scenarios }})</option> }</select>
          <span class="grow"></span><span class="muted" style="font-size:11px">pick a cell → sets model × scenario and opens Find Break</span></div></div>
        <div class="card" style="margin-bottom:12px">
          <span class="label-mono">Import from page source</span>
          <p class="muted" style="font-size:11px;margin:6px 0">Model codenames are randomized per operator — paste the Gray Swan chat page source (browser → Ctrl+U) to rebuild your model roster + break matrix + scenario descriptions.</p>
          <textarea class="textarea" style="min-height:70px" [(ngModel)]="pageSrc" placeholder="paste the full chat page source here…"></textarea>
          <div class="row" style="margin-top:8px"><button class="btn primary" (click)="importPage()" [disabled]="!pageSrc.trim() || importing()">{{ importing() ? 'importing…' : 'import page source' }}</button>@if (importStatus()) { <span class="muted" style="font-size:11px">{{ importStatus() }}</span> }</div>
        </div>
        @if (detail(); as d) {
          <!-- single break matrix: all models by global breaks, with your breaks + manual wave assignment -->
          <div class="card">
            <div class="row spread" style="margin-bottom:10px"><span class="label-mono">break matrix — all models by global breaks</span>
              <span class="row"><span class="label-mono" style="margin-right:6px">wave</span>
                <select class="input" style="max-width:150px" [ngModel]="waveFilter()" (ngModelChange)="waveFilter.set($event)">
                  <option value="all">all</option><option value="1">Wave 1</option><option value="2">Wave 2</option><option value="3">Wave 3</option><option value="">unassigned</option>
                </select>
              </span>
            </div>
            <div style="overflow:auto"><table class="matrix">
              <thead><tr>
                <th class="left" style="cursor:pointer" (click)="sortBy('model')">model {{ sortArrow('model') }}</th>
                <th style="cursor:pointer" title="global field breaks (all operators, from page source)" (click)="sortBy('field')">field brk {{ sortArrow('field') }}</th>
                <th style="cursor:pointer" title="your recorded breaks" (click)="sortBy('my')">my brk {{ sortArrow('my') }}</th>
                <th style="cursor:pointer" (click)="sortBy('wave')">wave {{ sortArrow('wave') }}</th>
                @for (s of ipiScenarios(); track s.code) { <th [title]="s.name" style="cursor:pointer" (click)="sortBy(s.code)">{{ s.code }} {{ sortArrow(s.code) }}</th> }
              </tr></thead>
              <tbody>
                @for (m of rows(); track m.id) {
                  <tr>
                    <td class="left">{{ m.name }}</td>
                    <td class="dim" style="text-align:right">{{ m.fieldBreaks }}</td>
                    <td style="text-align:right;color:var(--lime);font-weight:600">{{ myBreaks(m) }}</td>
                    <td><select class="input" style="height:22px;font-size:11px;padding:0 4px" [ngModel]="m.wave" (ngModelChange)="setModelWave(m, $event)"><option value="">—</option><option value="1">W1</option><option value="2">W2</option><option value="3">W3</option></select></td>
                    @for (s of ipiScenarios(); track s.code) {
                      <td class="cell" [class]="'v-' + verdictOf(m, s.code)" (click)="openAttack(m.name, s.code)" [title]="m.name + ' × ' + s.code + ' — open in Find Break'">{{ sym(verdictOf(m, s.code)) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table></div>
            <div class="legend">
              <span><i class="v-break"></i> break</span><span><i class="v-wall"></i> wall</span>
              <span><i class="v-partial"></i> partial</span><span><i class="v-untested"></i> untested</span>
              <span class="muted" style="margin-left:10px">click a header to sort · field brk = global · my brk = yours · set wave per row</span>
            </div>
          </div>

          <!-- per-wave tables of the models you assigned -->
          @for (w of assignedWaves(); track w) {
            <div class="card" style="margin-bottom:12px">
              <div class="row spread" style="margin-bottom:10px"><span class="label-mono">Wave {{ w }} — assigned models ({{ modelsOfWave(w).length }})</span></div>
              <div style="overflow:auto"><table class="matrix">
                <thead><tr><th class="left">model</th><th>field brk</th><th>my brk</th><th>wave</th>@for (s of ipiScenarios(); track s.code) { <th [title]="s.name">{{ s.code }}</th> }</tr></thead>
                <tbody>
                  @for (m of modelsOfWave(w); track m.id) {
                    <tr>
                      <td class="left">{{ m.name }}</td>
                      <td class="dim" style="text-align:right">{{ m.fieldBreaks }}</td>
                      <td style="text-align:right;color:var(--lime);font-weight:600">{{ myBreaks(m) }}</td>
                      <td><select class="input" style="height:22px;font-size:11px;padding:0 4px" [ngModel]="m.wave" (ngModelChange)="setModelWave(m, $event)"><option value="">—</option><option value="1">W1</option><option value="2">W2</option><option value="3">W3</option></select></td>
                      @for (s of ipiScenarios(); track s.code) {
                        <td class="cell" [class]="'v-' + verdictOf(m, s.code)" (click)="openAttack(m.name, s.code)" [title]="m.name + ' × ' + s.code + ' — open in Find Break'">{{ sym(verdictOf(m, s.code)) }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table></div>
            </div>
          }
          <h2 style="font-size:15px;margin:18px 0 8px">Scenario register</h2>
          @for (s of ipiScenarios(); track s.code) {
            <div class="card alt">
              <div class="row spread" style="cursor:pointer" (click)="toggle(s.code)">
                <div class="row"><span class="chip lime">{{ s.code }}</span><strong>{{ s.name }}</strong></div>
                <span class="dim">{{ s.breaksDone }}/{{ s.breaksTotal }}</span>
              </div>
              @if (open().has(s.code)) {
                <div style="margin-top:10px;display:grid;gap:8px">
                  <div><span class="label-mono">objective</span><p class="dim">{{ s.objective }}</p></div>
                  @if (s.benignTask) { <div><span class="label-mono">benign task</span><p class="dim">{{ s.benignTask }}</p></div> }
                  @if (s.criteria) { <div><span class="label-mono">criteria</span><p class="dim">{{ s.criteria }}</p></div> }
                  @for (f of s.surfaces; track f.key) { <div class="mono dim" style="font-size:12px">{{ f.required ? '★ ' : '• ' }}{{ f.key }} — {{ f.fieldsCsv }}</div> }
                  @if (s.markers.length) { <div class="mono dim" style="font-size:12px">{{ markerStr(s) }}</div> }
                </div>
              }
            </div>
          }
        } @else { <p class="dim">Loading…</p> }
      }

      <!-- ───────── RECON (dossier dashboard, TENEBRIS Analyze layout) ───────── -->
      @if (tab()==='analyze') {
        @if (dossier(); as d) {
          <div class="card">
            <div class="row spread">
              <div><span class="label-mono" style="color:var(--lime)">{{ modelName }}</span> <span class="mono dim" style="font-size:12px">× {{ scenarioCode }}</span></div>
              <button class="btn" (click)="onSelect()">↻ refresh</button>
            </div>
            <div class="row" style="margin-top:10px"><input class="input grow" [(ngModel)]="scaffold" placeholder="scaffold / harness" />
              <input class="input grow" [(ngModel)]="toolNs" placeholder="tool namespace" />
              <label class="row" style="gap:6px"><input type="checkbox" [(ngModel)]="browser" /> <span class="dim">browser</span></label>
              <button class="btn" (click)="saveMeta()">save</button></div>
            <div class="row" style="margin-top:8px"><select class="input" style="max-width:120px" [(ngModel)]="factKind"><option value="filter">filter</option><option value="gate">gate</option><option value="system_tag">system_tag</option></select>
              <input class="input grow" [(ngModel)]="factName" placeholder="name" /><input class="input grow" [(ngModel)]="factDetail" placeholder="detail" />
              <button class="btn" (click)="addFact()" [disabled]="!factName.trim()">+ fact</button></div>
          </div>

          <div class="rgrid">
            <!-- col 1: tools & call syntax -->
            <div class="card alt">
              <span class="label-mono">tools &amp; call syntax</span>
              @for (t of d.tools; track t.id) {
                <div class="card" style="margin-top:8px;padding:10px">
                  <div class="row spread"><span class="mono" style="font-size:12.5px;color:var(--lime)">{{ t.name }}</span><a class="muted" style="cursor:pointer" (click)="delTool(t.id)">✕</a></div>
                  @if (t.notation) { <pre class="mono dim" style="white-space:pre-wrap;font-size:11px;margin:6px 0 0">{{ t.notation }}</pre> }
                  @if (t.resultFormat) { <div style="margin-top:6px"><span class="muted" style="font-size:10px">result shape</span><pre class="mono dim" style="white-space:pre-wrap;font-size:11px;margin:2px 0 0">{{ t.resultFormat }}</pre></div> }
                  @if (t.note) { <p class="dim" style="font-size:11px;margin:6px 0 0">{{ t.note }}</p> }
                  @for (c of t.calls; track c.id) { <div class="mono dim" style="font-size:11px;margin-top:4px">↳ {{ short(c.args) }} ⇒ {{ short(c.result) }}</div> }
                </div>
              }
              @if (!d.tools.length) { <p class="muted" style="font-size:11.5px;margin-top:8px">Nothing captured yet — paste a victim run into Find Break; the crafter records tools here.</p> }
            </div>

            <!-- col 2: hard filters + gates -->
            <div>
              <div class="card alt"><span class="label-mono">hard filters</span>
                @for (f of factsOf(d,'filter'); track f.id) { <div class="card" style="margin-top:6px;padding:8px"><div class="row spread"><span class="mono" style="font-size:12px">{{ f.name }}</span><a class="muted" style="cursor:pointer" (click)="delFact(f.id)">✕</a></div>@if (f.detail) { <p class="dim" style="font-size:11px;margin:3px 0 0">{{ f.detail }}</p> }</div> }
                @if (!factsOf(d,'filter').length) { <p class="muted" style="font-size:11px;margin-top:6px">none captured</p> }
              </div>
              <div class="card alt" style="margin-top:12px"><span class="label-mono">gates</span>
                @for (f of factsOf(d,'gate'); track f.id) { <div class="card" style="margin-top:6px;padding:8px"><div class="row spread"><span class="mono" style="font-size:12px">{{ f.name }}</span><a class="muted" style="cursor:pointer" (click)="delFact(f.id)">✕</a></div>@if (f.detail) { <p class="dim" style="font-size:11px;margin:3px 0 0">{{ f.detail }}</p> }</div> }
                @if (!factsOf(d,'gate').length) { <p class="muted" style="font-size:11px;margin-top:6px">none captured</p> }
              </div>
            </div>

            <!-- col 3: system tags + scenario recon -->
            <div>
              <div class="card alt"><span class="label-mono">system / template tags</span>
                @for (f of factsOf(d,'system_tag'); track f.id) { <div class="card" style="margin-top:6px;padding:8px"><div class="row spread"><span class="mono" style="font-size:12px">{{ f.name }}</span><a class="muted" style="cursor:pointer" (click)="delFact(f.id)">✕</a></div>@if (f.detail) { <p class="dim" style="font-size:11px;margin:3px 0 0">{{ f.detail }}</p> }</div> }
                @if (!factsOf(d,'system_tag').length) { <p class="muted" style="font-size:11px;margin-top:6px">none captured</p> }
              </div>
              <div class="card alt" style="margin-top:12px"><span class="label-mono">scenario recon — ground truth</span>
                <div class="row" style="margin-top:6px"><input class="input" style="max-width:100px" [(ngModel)]="reconCat" placeholder="tag" /><input class="input grow" [(ngModel)]="reconText" placeholder="a fact…" /><button class="btn" (click)="addReconNote()" [disabled]="!reconText.trim()">+</button></div>
                @for (n of reconNotes(); track n.id) { <div class="card" style="margin-top:6px;padding:8px"><div class="row spread"><span style="font-size:12px">@if (n.category) { <span class="chip">{{ n.category }}</span> }{{ n.text }}</span><a class="muted" style="cursor:pointer" (click)="delReconNote(n.id)">✕</a></div></div> }
                @if (!reconNotes().length) { <p class="muted" style="font-size:11px;margin-top:6px">no facts for this scenario yet</p> }
              </div>
            </div>
          </div>
        } @else { <p class="dim">select a model × scenario…</p> }
      }

      <!-- ───────── FIND BREAK (arena left · craft agent right) ───────── -->
      @if (tab()==='attack') {
        <div class="card" style="margin-bottom:10px"><div class="stepper">
          @for (s of attackSteps; track s; let i = $index) {
            <button class="step" [class.active]="aStep()===s" [class.done]="aIdx(aStep())>i" [class.todo]="aIdx(aStep())<i" (click)="aRun(s)"><span class="n">{{ i+1 }}</span>{{ aLabel(s) }}</button>
            @if (i < 4) { <span class="step-sep">→</span> }
          }
        </div></div>

        <div class="workspace" #ws style="height:74vh">
          <!-- LEFT: embedded arena (resizable via the splitter) -->
          <div class="pane" [style.flexBasis.%]="arenaPct()" style="flex-grow:0;flex-shrink:0;min-width:300px">
            <mg-arena-pane (picked)="onPick($event)"></mg-arena-pane>
          </div>
          <div class="splitter" (mousedown)="startDrag($event)" title="drag to resize the arena"></div>

          <!-- RIGHT: craft agent -->
          <div class="pane scroll" style="flex:1;min-width:380px">
            <!-- vertical source buttons (open modal windows) -->
            <div class="card">
              <span class="label-mono">build the system prompt</span>
              <div style="display:flex;flex-direction:column;gap:7px;margin-top:8px">
                <button class="btn" style="justify-content:flex-start" (click)="openOverlay('breaks')">🎯 Break from prompt library as reference ({{ selBreaks().size }})</button>
                <button class="btn" style="justify-content:flex-start" (click)="openOverlay('blocks')">🧩 Building blocks ({{ selBlocks().size }})</button>
                <button class="btn" style="justify-content:flex-start" (click)="openOverlay('techs')">⚔ Techniques ({{ selTechs().size }})</button>
                <button class="btn" style="justify-content:flex-start" (click)="openOverlay('tools')">🛠 Tool calls / forge ({{ dossier()?.tools?.length || 0 }})</button>
                <button class="btn" style="justify-content:flex-start" (click)="openOverlay('markers')">✎ Markers ({{ markers().length }})</button>
                <button class="btn" style="justify-content:flex-start" (click)="openPrompt()">👁 View system prompt</button>
                <label class="row" style="gap:6px;font-size:12px;margin-top:3px"><input type="checkbox" [(ngModel)]="includeRecon" /> include scenario recon (world facts)</label>
              </div>
            </div>

            <div class="card" style="min-height:160px;margin-top:10px">
              @for (v of view(); track $index) {
                @if (v.type==='tool') { <div class="mono" style="font-size:11px;color:var(--amber);margin:4px 0">⚙ {{ v.text }}</div> }
                @else if (v.type==='user') { <div style="margin-bottom:10px"><span class="label-mono" style="color:var(--lime)">user</span><pre class="mono" style="white-space:pre-wrap;font-size:13px;line-height:1.5;margin-top:4px;color:var(--text)">{{ v.text }}</pre></div> }
                @else {
                  <div style="margin-bottom:10px">
                    <div class="label-mono" style="color:var(--text-mute)">assistant</div>
                    @if (v.reasoning) {
                      <div class="label-mono" style="color:var(--amber);cursor:pointer;margin-top:4px" (click)="toggleReasoning($index)">{{ v.reasoningOpen ? '▾' : '▸' }} reasoning</div>
                      @if (v.reasoningOpen) { <pre class="mono dim" style="white-space:pre-wrap;font-size:11.5px;line-height:1.45;border-left:2px solid var(--surface-3);padding-left:8px;margin:4px 0 8px">{{ v.reasoning }}</pre> }
                    }
                    <pre class="mono" style="white-space:pre-wrap;font-size:13px;line-height:1.5;margin-top:4px;color:var(--text)">{{ v.text }}</pre>
                  </div>
                }
              }
              @if (!view().length) { <p class="dim">The ONE chat drives the loop: paste a victim RUN (the crafter analyses it into the dossier/recon, then crafts the next payload) or type FEEDBACK. ① craft → ② ⌖pick + fill → ③ you launch → ④ read back → ⑤ record.</p> }
            </div>

            <div class="card" style="margin-top:10px">
              <textarea class="textarea" [(ngModel)]="input" (keydown.control.enter)="send()" placeholder="message the crafter / paste a victim run… (Ctrl+Enter)"></textarea>
              <div class="row" style="margin-top:8px"><button class="btn primary" (click)="send()" [disabled]="streaming() || !input.trim()">{{ streaming() ? 'crafting…' : 'send' }}</button>
                <span class="grow"></span>
                <button class="btn" [class.primary]="encKeys().length>0 || encMarked" (click)="openOverlay('enc')" title="encode payload before filling">encode ({{ encKeys().length }}{{ encMarked ? ', [ENC]' : '' }})</button>
                <button class="btn" (click)="fillIntoTab()" [disabled]="!arena.available">fill →</button><button class="btn" (click)="readBack()" [disabled]="!arena.available">read back</button>
                <button class="btn" (click)="judge()">judge</button></div>
              <div class="field" style="margin-top:8px"><label>fill target — ⌖ pick element on the page, or type a CSS selector</label>
                <input class="input" [(ngModel)]="fillSel" placeholder="#chatTextarea" /></div>
              <div class="row" style="margin-top:8px"><span class="grow"></span><span class="label-mono">record:</span><button class="btn" (click)="record('break')">break</button><button class="btn" (click)="record('wall')">wall</button><button class="btn" (click)="record('partial')">partial</button></div>
              <p class="dim" style="font-size:11px;margin-top:8px">dossier: filters {{ factCount('filter') }} · gates {{ factCount('gate') }} · tags {{ factCount('system_tag') }} · tools {{ dossier()?.tools?.length || 0 }} · injections {{ dossier()?.injections?.length || 0 }}</p>
            </div>
          </div>
        </div>

        <!-- ═══ modal overlays (windows) — arena view is hidden behind them ═══ -->
        @if (overlay()) {
          <div class="overlay-back" (click)="closeOverlay()">
            <div class="card" style="width:min(720px,92vw);max-height:84vh;overflow:auto" (click)="$event.stopPropagation()">
              <div class="row spread" style="margin-bottom:10px"><span class="label-mono">{{ overlayTitle() }}</span><button class="btn" (click)="closeOverlay()">close</button></div>

              @if (overlay()==='breaks') {
                <p class="muted" style="font-size:11px">Prompts from your library, patched in as reference breaks (the move — not copied verbatim; markers stay literal). Break-verdict first.</p>
                <input class="input" style="margin-top:8px" [(ngModel)]="breakSearch" placeholder="search title / tags…" />
                @for (p of filteredBreakRefs(); track p.id) {
                  <label class="row" style="gap:8px;margin-top:7px;align-items:flex-start"><input type="checkbox" [checked]="selBreaks().has('prompt:'+p.id)" (change)="pick(selBreaks, 'prompt:'+p.id)" />
                    <span><span class="chip" [class.lime]="p.verdict==='break'">{{ p.verdict }}</span> <strong style="font-size:12.5px">{{ p.title }}</strong>@if (p.tags) { <span class="mono dim" style="font-size:11px"> · {{ p.tags }}</span> }</span></label>
                }
                @if (!filteredBreakRefs().length) { <p class="muted" style="font-size:12px;margin-top:8px">No matching prompts. Save winning payloads in the Prompt Library first.</p> }
              }

              @if (overlay()==='blocks') {
                @for (b of blocks(); track b.id) { <label class="row" style="gap:8px;margin-top:7px"><input type="checkbox" [checked]="selBlocks().has(b.id)" (change)="pick(selBlocks, b.id)" /> <span class="chip">{{ b.type }}</span><span class="dim" style="font-size:12px">{{ b.content }}</span></label> }
                @if (!blocks().length) { <p class="muted" style="font-size:12px">no building blocks</p> }
              }

              @if (overlay()==='techs') {
                @for (t of techniques(); track t.id) { <label class="row" style="gap:8px;margin-top:7px;align-items:flex-start"><input type="checkbox" [checked]="selTechs().has(t.id)" (change)="pick(selTechs, t.id)" /> <span><strong style="font-size:12.5px">{{ t.title }}</strong>@if (t.tags) { <span class="mono dim" style="font-size:11px"> · {{ t.tags }}</span> }@if (t.summary) { <p class="dim" style="font-size:11px;margin:2px 0 0">{{ t.summary }}</p> }</span></label> }
              }

              @if (overlay()==='tools') {
                <p class="muted" style="font-size:11px">Captured victim tools — insert a call notation into the message, or forge a tool-result block.</p>
                @for (t of dossier()?.tools ?? []; track t.id) {
                  <div class="card" style="margin-top:8px;padding:10px"><div class="row spread"><span class="mono" style="font-size:12.5px;color:var(--lime)">{{ t.name }}</span>
                    <div class="row"><button class="btn" style="height:22px;padding:2px 8px" (click)="insertToolCall(t.notation || t.name)">insert call</button><button class="btn" style="height:22px;padding:2px 8px" (click)="forgeResult(t.name)">forge result</button></div></div>
                    @if (t.notation) { <pre class="mono dim" style="white-space:pre-wrap;font-size:11px;margin:4px 0 0">{{ t.notation }}</pre> }
                    @for (c of t.calls; track c.id) { <div class="mono dim" style="font-size:11px;margin-top:2px">↳ {{ short(c.args) }} ⇒ {{ short(c.result) }}</div> }
                  </div>
                }
                @if (!(dossier()?.tools?.length)) { <p class="muted" style="font-size:12px;margin-top:8px">no tools captured — paste a victim run into the crafter to record them.</p> }
              }

              @if (overlay()==='markers') {
                <div class="row" style="flex-wrap:wrap;gap:6px">@for (m of markers(); track m.token) { <span class="chip" style="cursor:pointer" (click)="insert(m.token)">{{ m.token }} <a (click)="removeMarker(m.token); $event.stopPropagation()">✕</a></span> }</div>
                <div class="row" style="margin-top:8px"><input class="input grow" [(ngModel)]="newMarker" placeholder="{{ '{{owner.email}}' }}" /><button class="btn" (click)="addMarker()" [disabled]="!newMarker.trim()">add</button></div>
                <p class="muted" style="font-size:11px;margin-top:6px">Click a marker to insert it into the message. The harness substitutes the real value at submission.</p>
              }

              @if (overlay()==='prompt') {
                <div class="row" style="margin-bottom:8px"><button class="btn" (click)="resyncPrompt()">↻ re-sync from selection</button><span class="muted" style="font-size:11px;margin-left:8px">edited text is used on send</span></div>
                <textarea class="textarea" style="min-height:300px" [(ngModel)]="promptDraft"></textarea>
              }

              @if (overlay()==='enc') {
                <div class="row spread"><span class="muted" style="font-size:11px">applied to the payload on fill →</span><label class="row" style="gap:6px;font-size:12px"><input type="checkbox" [(ngModel)]="encMarked" /> only [ENC]…[/ENC] spans</label></div>
                @for (cat of encCategories(); track cat) {
                  <div style="margin-top:8px"><span class="muted mono" style="font-size:10.5px">{{ cat }}</span>
                    <div class="row" style="flex-wrap:wrap;gap:5px;margin-top:4px">@for (t of encByCat(cat); track t.key) { <span class="chip" style="cursor:pointer" [class.lime]="encKeys().includes(t.key)" (click)="toggleEnc(t.key)" [title]="t.key">{{ t.name }}</span> }</div></div>
                }
                <div class="row" style="margin-top:10px"><span class="muted" style="font-size:11px">chain: {{ encKeys().length ? encKeys().join(' → ') : '(none)' }}</span><span class="grow"></span><button class="btn" (click)="encKeys.set([])" [disabled]="!encKeys().length">clear</button></div>
              }
            </div>
          </div>
        }
      }
    </section>
  `,
  styles: [`
    .rgrid { display:grid; grid-template-columns:1.15fr 1fr 1fr; gap:12px; align-items:start; margin-top:12px; }
    @media (max-width:1000px){ .rgrid{ grid-template-columns:1fr; } }
    .splitter { flex:0 0 8px; align-self:stretch; cursor:col-resize; background:var(--surface-3); border-radius:4px; margin:0 2px; }
    .splitter:hover { background:var(--lime); }
    .overlay-back { position:fixed; inset:0; background:rgba(8,8,12,.82); display:flex; align-items:center; justify-content:center; z-index:60; padding:20px; }
  `],
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
