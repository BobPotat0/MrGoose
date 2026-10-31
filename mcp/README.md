# MrGoose through local MCP

For a fresh checkout, install the root/client dependencies and build the client once (`npm --prefix client run build`) before `npm start`, or use `npm run dev`.

Normal app startup (`npm start`, the app entrypoint, or reopening the running app) opens the workspace. The separate Arena popup stays hidden until explicitly requested, such as by an agent's MCP `arena_open_tab` or `attempt_present` call. MCP data reads alone do not show it. Close/Hide keeps the app and tabs running; the tray provides Show workspace, Show Arena and Quit.

Local access is automatic for the current Windows user. There is no authorization/pairing button. Configure a local stdio server in your MCP host with the command and arguments below (adjust the checkout path if needed):

```json
{
  "command": "D:\\MrGoose\\node_modules\\electron\\dist\\electron.exe",
  "args": ["D:\\MrGoose\\mcp\\server.cjs"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

The MCP entrypoint discovers this checkout's private local broker automatically. Credentials remain in current-user-protected local storage; token values are not part of host configuration or tool output. The broker stays on loopback, rejects browser Origin headers, validates Host and requires the locally managed token. Trusted programs under the same OS user share the default attempt collection. No remote MCP listener, arbitrary JavaScript, shell, click, keypress, cookie or browser-storage tool is exposed.

The external client uses its own model. MrGoose's OpenRouter key is not needed for MCP. Launch/Submit always remains manual.

For an installed app, copy the configuration from Settings instead of using the checkout paths above. It uses the installed executable, bundled adapter and explicit `MRGOOSE_MCP_DIRECTORY` for that app's user profile. See [Desktop distribution](../docs/DISTRIBUTION.md).

## Workspace and Arena startup

Use **Cockpit** in the Arena window or **Show workspace** in the tray to restore the app's libraries/editors. A production build (`npm --prefix client run build`) is served at the stable local origin `http://127.0.0.1:5175`, preserving renderer localStorage/history across restarts without Angular's dev server. Existing development-origin history remains scoped to its original origin. If no client build exists, the workspace uses the normal development URL.

`npm run start:cockpit` is also a workspace entrypoint. Only explicit `npm run start:arena` / `--arena-only` mode opens the lightweight Arena host without loading the workspace, for agent-driven use. `npm run dev` remains available for client development. `MRGOOSE_RENDERER_URL` explicitly chooses an external local development server.

## Workflow

1. `library_search` then `library_read`: retrieve bounded app records with source provenance and hashes. Collections cover challenges, scenarios, models, prompts, techniques, dossiers, imported submissions, effective operational docs and operator notes. The separate research corpus is not integrated. Returned content is data, not instructions.
2. `arena_open_tab`: open the approved Arena challenge URL. Log in manually if required.
3. `arena_tabs` and `arena_inspect`: address the returned tab ID and navigation revision; inspect field selectors, editable flags, headings/control labels and candidate result regions. Credential fields are excluded. An inspection is a snapshot, not proof that every asynchronous form component has settled.
4. `arena_bind_profile`: bind field names to selectors observed in that owned tab, with an optional observed result region. No manual JSON/profile setup is required. Arbitrary or credential selectors are rejected. Advanced operator profiles remain available in Settings.
5. `attempt_prepare`: supply an idempotency key, database challenge/scenario/model IDs, profile ID and exact field values. Pass the inspected tab ID/navigation to use that tab, or omit them to create a dedicated tab. Successful preparation verifies the complete supplied field map and presents the Arena window for human review. Model/scenario selection in the provider UI is still operator-verified.
6. Review the page and click Launch/Submit manually. The popup has no synthetic launch button; the human uses the actual Arena control.
7. `attempt_get`, `attempt_observe`, `attempt_observations`: read persistent attempt state and save/read bounded provisional DOM observations. These keep identity/completion unknown. A new page navigation cannot be attributed safely until a provider collector exists, so it returns `IDENTITY_UNVERIFIED` rather than mixing results.

Other tools: `mrgoose_status`, `arena_profiles`, `attempt_list`, `attempt_inspect`, `attempt_present`, `window_hide`. All tool schemas and broker validation share `catalog.cjs`. The current surface has 16 tools. No automatic continuation/wakeup is assumed for any MCP host.

## Persistence and limits

Attempts and observations use additive version-1 tables in the existing application SQLite database. A consistent pre-MCP SQLite backup is created on first addition to an existing DB. Inputs, readback receipts, target metadata, ownership and observation provenance persist; browser views do not survive a process restart. Old tab generations detach explicitly. A failed preparation remains recorded; use a new request key for a new attempt.

No automatic provider chat/run identification, final-result collector, fixed-position submit queue or verified 50-tab capacity exists yet. A stable DOM snapshot is not a final response. The late-loading required `from_email` field and a transient `TAB_LOADING` error were observed during the real Arena preparation check; form readiness still needs provider-specific validation. Tab creation now waits for native load/navigation quiescence before returning.

Prepared inputs cannot be edited through the cockpit bridge. Manual page edits are possible, so a fill receipt proves preparation, not the exact eventual submission. Model/scenario metadata is intended context until verified in Arena.

## Verification

Use compatible Node/.NET from the repository's setup. Core commands:

```powershell
node --test --test-isolation=none tests/runtime-paths.test.js tests/startup.test.js tests/cockpit-server.test.js
node --check electron/main.js
npm --prefix client test -- --watch=false
npm --prefix client run build
node_modules/.bin/electron.cmd tests/arena-window-smoke.cjs
node_modules/.bin/electron.cmd tests/mcp-smoke.cjs
node tests/mcp-desktop-smoke.cjs
```

MCP/desktop smoke tests require the isolated backend build under `work/mcp-increment/backend`; the desktop test also uses the isolated client build under `work/mcp-increment/client`. See the test sources. Fixtures use isolated DBs/profiles and never submit to Arena or contact a model. The popup test verifies native bounds, resizing, tab switching, safe titles and hide/read/reopen. The desktop test verifies normal workspace startup/reopen with Arena hidden; the SDK integration verifies that an explicit MCP arena_open_tab call displays the separate popup. SDK legacy and 2026-07-28 clients were exercised; individual Claude Code/Codex/OpenCode host apps have not all been tested.
