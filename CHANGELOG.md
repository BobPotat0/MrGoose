# Changelog

## Unreleased — 2026-10-27 — Organizer/Attacker roles, craft modes, MCP role tools, dockable arena
- Renamed the assistant role to **Mr Goose Organizer** and the Break Workbench crafter to **Mr Goose Attacker** throughout — labels, system prompts, code symbols, files and wire names: SignalR methods/events are now `organizer*`/`attacker*`, REST routes are `/api/organizer/*`, the hub is `/hub/cockpit`, and the `AgentFiles` table is renamed to `OrganizerFiles` on existing databases at startup.
- Added a **Direct / MCP** mode toggle to the Attacker craft panel: MCP mode hides the in-app chat and composer and shows a status card, while the Craft context stays visible for an external client to pull (choice persisted per viewer).
- Added three **MCP role tools** (surface now 19): `read_attack_context` (the crafting context for a model × scenario), `organizer_catalog` (list the organizer's data operations) and `organizer_run` (run one read/write organizer operation on local data; arena page and conversation-file tools are rejected). New broker scopes `organizer.read/write` and `attack.read` are granted to the local client automatically.
- The Gray Swan browser is **embedded in the cockpit by default** again and can be **detached** into its own window and **docked** back, with new tabs available in both; MCP `arena_open_tab`/`present` target whichever surface currently hosts the arena.

## Unreleased — 2026-10-26 — Agent technique table and local chat history
- Markdown files now open in formatted Preview (headings, lists, tables, links and fenced code), with an exact Source toggle. Raw HTML is displayed literally, remote images are not fetched, and downloads remain unchanged. Uses pinned marked 18.1.2 and Angular HTML sanitization.
- Session Files: persistent agent-created and user-uploaded UTF-8 text artifacts in the existing `mrgoose.db` (`AgentFiles` table), clickable conversation file cards, right-side preview, multi-file Upload / drag-and-drop, CSV table view and exact-content downloads. `create_file`, `list_files`, `read_file` are scoped to the calling conversation; file content is retrieved on demand. Supported formats: .txt/.md/.json/.csv, up to 1 MiB each. Confirmed chat deletion removes its files.
- Agent interface: grouped Workspace / Libraries / Agent sessions sidebar, compact composer (Enter sends; Shift+Enter inserts a newline), and an Instructions toggle containing the existing system prompt and knowledge editors. Original global background and library/workbench pages are unchanged. Sessions use neutral date/time titles with manual renaming; legacy first-message titles migrate without changing messages.
- Added `show_techniques`: the agent opens a read-only table of the current built-in and custom techniques inside chat, with applicability notes and expandable examples. The model receives a short display acknowledgement.
- Added local Mr Goose Agent conversation history: new/reopen/delete chats, restart restoration, partial-response checkpoints and visible storage errors. Only the selected conversation is sent to the model; saved tool activity and technique tables remain visible. History uses renderer local storage scoped to the backend URL, without a database migration. This does not add Workbench/Finder history.

## 0.12.0 — 2026-10-25 — Matrix rework, app icon, persistent agent chat
- **Break matrix reworked** to a single table: ALL models sorted by global field breaks, with a **my brk** column (your recorded breaks), **clickable column headers to sort** (model / field brk / my brk / wave / any scenario), and a per-row **manual wave assignment** dropdown. Per assigned wave, a **"Wave N — assigned models"** table appears below. (Dropped the auto wave/area grouping — the parser can't know an unbroken model's wave.) Manual wave assignment persists across re-import.
- Fixed the page-source import regression (migration targeted the wrong table name `Models`) and added a `Wave` column.
- **App icon:** the pixel-goose logo is now the Electron window / taskbar icon (`electron/icon.ico` + `icon.png`, `setAppUserModelId`).
- **Mr Goose Agent chat now persists across tab switches** (conversation moved into a singleton `AgentChatStore`); added a **clear** button. The reasoning toggle now sits under the "mr goose" label instead of on the same line.

## 0.11.0 — 2026-10-25 — Streaming + reasoning, editable KB, wave sort, fixes
- **Streaming + collapsible reasoning** for the conversational agents (Mr Goose Agent + the Find-Break crafter, and the Finder instructor): answers now generate **token-by-token**, and models that expose reasoning show a **▸ reasoning** block you can expand/collapse per message. New `OpenRouterClient.StreamCompleteAsync` (SSE with tool-call accumulation + reasoning deltas); hub emits `*Reasoning` events.
- **Agent knowledge base is now editable in-app** + **reset to default**: edit any `knowledge/*.md` doc from the Mr Goose Agent page (overrides stored as settings, applied to the system prompt immediately); reset one or all back to the shipped defaults.
- **Break matrix: sort by wave** — a `sort` dropdown (all waves / Wave 1-3) in the Overview; per-wave break counts are parsed from the page source (behavior prefixes) on import.
- **Fixes:** page-source import failed because the migration targeted the wrong table name (`Models`, not `ModelAgents`) — the `WaveBreaksJson` column now adds correctly; OpenRouter key is ASCII-sanitized on save + before the Authorization header (stray invisible chars no longer crash the request); the "no key" banner + usage pills now refresh every 15s instead of only at startup.

## 0.10.1 — 2026-10-25 — Agent can now drive (almost) the whole app
- Added agent tools to close the last gaps: **challenges** (create/update/delete + update/delete scenario + set_markers), **recon** (set_dossier_meta + delete fact/tool/injection), **techniques** (reset + tag registry list/save/delete), **prompts** (update verdict/scenarioCode + set multi-shot follow-ups), **encoding** (encode_chain + list_encoders), and **arena** (pick element + list/select/close tabs). Settings/keys/model stay operator-only by design.

## 0.10.0 — 2026-10-25 — Keys (DPAPI), model search, usage pills, agent web search
- **Settings → OpenRouter keys:** store **several named keys**, pick the active one; each is **encrypted at rest with Windows DPAPI** (CurrentUser) and never returned in full. The brain services resolve the active key (legacy single key still works as a fallback).
- **Settings → Model picker with search:** searches the live OpenRouter model catalog (`/api/models`) and lets you pick by id/name (with per-token pricing), or type an id.
- **Header usage pills** (left of "backend ok", like TENEBRIS): **spent today** + **balance**, from OpenRouter credits — balance = credits − usage; spent today = usage delta since the first fetch of the day. Refreshes each minute.
- **Mr Goose Agent `web_search` tool:** searches the web via an OpenRouter online model so the agent can **find new jailbreak/IPI techniques and add them** with create_technique.
- Backend: `OpenRouterKey` entity + `KeyStore` (DPAPI protect/unprotect + active-key resolution); `OpenRouterClient.GetModelsAsync` / `GetCreditsAsync`; `/api/keys`, `/api/models`, `/api/usage`; all key reads routed through `KeyStore`.

## 0.9.1 — 2026-10-25 — File-based agent knowledge base + SQLite CVE fix
- **Mr Goose Agent knowledge base is now a folder of docs** (`backend/knowledge/*.md`, like TENEBRIS), not a DB note list. Five docs describe the app (overview, prompt library, technique library, challenge library, break workbench); the backend appends them to the agent's system prompt and exposes `list_docs` / `read_doc` tools so the agent knows exactly how the program works. The assistant page lists + views the docs; the old DB notes stay as secondary "operator notes".
- Security: pinned `SQLitePCLRaw.bundle_e_sqlite3` 2.1.12 to clear NU1903 / CVE-2025-6965 (vulnerable SQLite < 3.50.2 pulled transitively by EF Core 10). `dotnet list package --vulnerable` now reports none.

## 0.9.0 — 2026-10-25 — Break Workbench to TENEBRIS Jailbreak-Agents depth
- **Recon** rebuilt as the TENEBRIS Analyze **3-column dossier dashboard**: Tools & call syntax (notation + result shape + fired calls) · Hard filters + Gates · System/template tags + Scenario recon — with inline meta/fact/recon editing and delete.
- **Find Break** reworked: **embedded arena LEFT, craft agent RIGHT**, with a **drag splitter** to resize the embedded Gray Swan browser (the native view follows the pane).
- Source buttons are now **stacked vertically in the agent area** and each opens a **modal window** (like TENEBRIS): Break-from-library · Building blocks · Techniques · Tool calls/forge · Markers · System prompt · Encoder. The native arena view hides behind the modal so it never covers it.
- **"Break from prompt library as reference"** (was "working-breaks"): the break picker now lists your **Prompt Library** entries (break-verdict first, searchable); selected prompts are patched into the system prompt as reference breaks (backend `prompt:` ref).
- Workflow confirmed end-to-end: the one craft chat classifies each message — a pasted **victim run is analysed into the dossier/recon** (record_* tools) then the next payload is crafted; fill/read-back/judge/record drive the loop.
- Backend: `DELETE /api/recon/{id}`; `ResolveBreaks` resolves `prompt:<id>` from the library.

## 0.8.0 — 2026-10-25 — Agent KB, lean techniques, library polish (Gray Swan only)
- **Mr Goose Agent** — its system prompt is now viewable + editable (persisted; reset-to-default) and it has a **knowledge base**: operator notes appended to the system prompt, which the agent can also read/write. Added tools so it can drive more of the app: folders (list/rename/delete), duplicate prompt, update/delete technique, knowledge CRUD, list models.
- **Prompt Library** — select part of a payload and **AI-edit or encode only that span** (splices back in place); the encoder is now **collapsed by default** (expand to reveal the catalog).
- **Technique Library** — trimmed to **5 Gray-Swan built-ins** and exactly **3 tags (direct · indirect · encoding)**; stale built-ins/tags are pruned on reset. Each technique now renders in **3 columns**: name+tags · description · example.
- **Challenge Library** — scenario cards show the **full description** (harmful/benign task, criteria, surfaces, markers, reference, judge context, known wall, ids).
- Backend: `KnowledgeNote` entity + `/api/knowledge` + `/api/agent/system` (get/put/reset); `TechniqueDefaults` reduced to 5/3 with prune.
- Next: Break Workbench redesign to TENEBRIS Jailbreak-Agents depth (Analyze 3-column dashboard, modal pickers, resizable arena, run→analyze→recon loop).

## 0.7.0 — 2026-10-25 — Libraries + encoder to TENEBRIS depth
- **Encoder** — the single-scheme select is now the full TENEBRIS catalog: 48 transforms across Encodings / Ciphers / Leet-obfuscation / Unicode-styles / Homoglyphs / Misc / Advanced-2026, chainable (apply several left→right) and span-scoped (`[ENC]…[/ENC]` only). Wired into the Prompt Library editor and the Break Workbench fill step; `/api/encode` takes `keys[]` + `marked`, `/api/encode/catalog` serves the grouped list.
- **Technique Library** — color-coded tags with a tag registry + editor, tag-filter chips, search, built-in badge, JSON import/export, and "reset built-ins". Seeded the 19-technique Gray Swan built-in catalog + 8 tags; built-ins restore on reset and can't be deleted (user techniques survive).
- **Prompt Library** — clipboard (copy / cut / paste-into-folder / duplicate), inline rename (double-click), search across title+tags+body, pinned folders (auto-expand, persisted) + collapse-all, per-prompt undo/redo of the payload, and multi-shot follow-up turns.
- **Break Workbench (Find Break)** — the fill encoder now exposes the full categorized catalog + marked-span toggle; a new "tool calls" picker lists captured victim tools + fired calls, inserts a call notation, or forges a tool-result block into the crafter message.
- Backend: `Technique` gains slug/builtin; new `TechniqueTag` registry; `Prompt.FollowUpsJson`; `TechniqueDefaults` shared by the seeder + reset endpoint; prompt duplicate endpoint.

## 0.6.0 — 2026-10-25 — Re-architecture (5 areas)
- Nav (top→bottom): **Mr Goose Agent · Prompt Library · Technique Library · Challenge Library · Break Workbench · Settings**.
- **Mr Goose Agent** — a global assistant that drives the whole app via tool-use: manage prompts+folders, techniques, challenges+objectives, recon/verdicts, encode, and (in the embedded arena) open tabs + fill (never send). Page tools are client-mediated over SignalR.
- **Prompt Library** — tree view with folders, per-prompt AI editor (OpenRouter), encoder (base64/rot13/reverse/zero-width/unicode-tags/homoglyph/leetspeak), JSON import/export.
- **Challenge Library** — the objective authoring tab (was "Challenges").
- **Break Workbench** — unifies the old Break Chatbot + Break Agent into one tool with tabs **Overview** (all-challenges picker + break matrix), **Recon** (per-model×scenario dossier = old Analyze), **Find Break** (**embedded arena page LEFT, craft agent RIGHT**; pickers/markers + per-fill encoding + judge; works for IPI and direct scenarios). Dropped the separate Chatbot/Arena-Tabs nav.
- Payload transfer: "⌖ pick element" captures a field's selector from the live arena DOM (→ the fill target); "fill →" runs a script in the page that sets that field's value + fires input/change so the arena registers it (optionally encoded first). Never sends — you click Launch.
- Backend: PromptFolder + folder/import/export/ai-edit/encode endpoints; `AgentService` (app tool-use) + `AgentChat`/`AgentPageResult` hub with client-mediated page tools; `Encoders`; scenario-based `/api/judge-direct`.
- Note: agent/crafter/judge/AI-editor need an OpenRouter key; live arena embedding needs the Electron app + Gray Swan login.

## 0.5.0 — 2026-10-25 — UX overhaul
- **Split workspace**: the embedded arena is now co-visible beside the crafter in both Break Chatbot and Break Agent › Attack (reusable `ArenaPaneComponent`), so fill + read-back happen next to the page instead of on a separate tab.
- **Guided loop stepper** with state (active/done/todo, auto-advance) in both modes — Chatbot: craft→fill→you send→read back→judge; Attack: craft→fill→you launch→read back→record.
- **Toasts** for success/error + a **global banner** (backend offline / no OpenRouter key → Settings).
- **Challenges**: real field labels + grouping (type-dependent fields); nav reordered to the workflow (Challenges → Chatbot → Agent → libraries → Arena → Settings).
- **Matrix**: single click opens the cell in Attack (no more accidental verdict-cycling); legend restored.
- Clickable-chip affordance (dashed border + hover), larger transcript/payload text, tab titles truncated in the arena strip.

## 0.4.0 — 2026-10-25 — Mode re-architecture (Finder vs IPI) + Challenges authoring
- Corrected the two modes to match TENEBRIS:
  - **Break Chatbot = direct jailbreak (Finder):** hunts/sessions, an instructor crafts a direct jailbreak for a victim model, you fill it into the arena chat + send, read the reply back, a Mr-Goose **judge** scores it 0–100 vs your success criteria; best-prompts, thresholds, winners saved to the Prompt Library. No injection surfaces/markers.
  - **Break Agent = IPI** with internal **Overview / Analyze / Attack** sub-tabs: Overview = break matrix (dbl-click a cell → Attack) + scenario register; Analyze = per-model×scenario dossier dashboard (filters/gates/system-tags/tools/injections); Attack = the crafter (pickers, markers, system-prompt, record_* tool-loop, fill into surface fields).
- **Challenges** is now the objective-authoring tab: CRUD over challenges + objectives, both **IPI scenarios** (surfaces/markers) and **direct behaviors** (success criteria), feeding both modes; seeded a demo direct behavior.
- Backend: Scenario gains type/reference/judgeContext; `FinderService` (instructor prompt + judge); `ChatSession`/`ChatTurn` store; `FinderCraft` hub stream; challenge/scenario CRUD + finder-session + judge endpoints.
- Note: instructor/judge need an OpenRouter key; live fill/read-back need the Electron app + Gray Swan login.

## 0.3.0 — 2026-10-25 — Break Chatbot + Break Agent to TENEBRIS depth
- Crafter brain ported from TENEBRIS `BuildCraftSystem`: 3-way message classification (victim-run / craft / talk), full scenario context (surfaces + field schemas, markers, recon, criteria, known wall), per-model×scenario dossier awareness, surface field-layout rule.
- OpenRouter **tool-loop**: the crafter reads the dossier (`list_dossier`/`list_injections`/`inspect_injection`/`list_tool_calls`/`inspect_tool_call`/`get_tool`) and records findings into it (`record_tool`/`record_fired_call`/`record_filter`/`record_gate`/`record_system_tag`/`record_scenario_recon`/`record_injection`) before crafting; tool activity streamed to the UI.
- Full per-model×scenario **dossier** model + API: scaffold / tool namespace / browser, tools (with fired calls), filters / gates / system-tags, injection history, verdict.
- **Break Chatbot**: pickers (working-breaks / building-blocks / techniques, patched into the prompt only when selected), editable per-scenario markers panel, view/edit/re-sync system prompt, transcript with tool activity, record-as-break, fill-into-tab.
- **Break Agent**: dossier dashboard (edit scaffold/namespace/browser, add/delete filters-gates-tags-tools-injections) + semi-auto loop (craft → fill → you send → read back → analyze-into-dossier → record verdict).
- Challenges matrix: double-click a cell → opens Break Agent preset to that model × scenario.
- Seeded building blocks; `/api/breaks` + `/api/building-blocks` + `/api/craft/system-prompt` + `/api/dossier*` endpoints.
- Note: the OpenRouter tool-loop needs a key to exercise; live arena fill needs the Electron app + Gray Swan login — both unverified headless.

## 0.2.0 — 2026-10-25 — P1–P5 feature build
- **P1 Embedding core** — Electron `WebContentsView` arena tabs (shared `persist:arena` session so the Gray Swan login sticks); fill-only page bridge wired end-to-end (`fillField` / `readDom` / `snapshotConversation` / `highlightSendButton` + `pickElement`), bounds-synced to the Arena Tabs page; still no send/launch/submit.
- **P2 Data + Challenges + Prompt Library + Import** — EF Core/SQLite store seeded with the 12 live scenarios, required surfaces, markers and the model × scenario break matrix; REST API; Challenges page (click-to-cycle matrix + scenario register); Prompt Library (list, add, delete, ZIP import, page-source matrix refresh). ZIP + page-source import verified against the real export.
- **P3 Technique Library** — CRUD page, seeded with two starter techniques.
- **P4 Break Chatbot** — OpenRouter crafter brain streamed over SignalR with per-scenario system context; "fill payload into active arena tab" (you press send).
- **P5 Break Agent** — per-model × scenario dossier + semi-auto loop (craft → fill → you send → read back → analyze → record verdict) + verdict recording into the matrix.
- Settings page (OpenRouter key/model, arena URL); OpenRouter key stored write-only.
- Fix: order DateTimeOffset client-side (SQLite can't ORDER BY it) for prompts/techniques/submissions.

## 0.1.0 — 2026-10-25 — P0 skeleton
- Project scaffolded: Electron shell + Angular 22 renderer + ASP.NET Core / .NET 10 backend sidecar.
- Backend: Minimal API `/health` + `AgentHub` SignalR hub (welcome + ping/pong), fixed loopback port, dev CORS.
- Electron main spawns the backend sidecar, waits for `/health`, loads the renderer, and kills the sidecar on quit.
- Preload exposes the **fill-only** page bridge (`fillField` / `readDom` / `snapshotConversation` / `highlightSendButton`) — no send/launch/submit, by design (Gray Swan RoE).
- Angular shell: Gray-Swan-inspired dark theme (lime accent, amber status, uppercase monospace labels, dot-grid, pixel-goose), left nav, backend health + hub status pills, and the 7 feature routes stubbed.
- Verified end-to-end in-browser: REST `/health` ok, SignalR hub connected, ping→pong round-trip, routing + route-data binding.
