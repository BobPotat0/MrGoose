# MrGoose through local MCP

Use a local MCP client to operate the running MrGoose desktop app. The external client supplies the model; MrGoose supplies library operations, crafting context and fill/read access to real Arena tabs. **Every Launch/Submit is a human action.**

## Setup

1. Install and open the desktop app, or follow the [source setup](../README.md#run-from-source).
2. In **Settings → Local MCP — connect an external agent**, copy **Config (mcpServers)**.
3. Add the generated server to a local MCP host with stdio support. Hosts may use different configuration wrappers; preserve the generated command, arguments and environment.
4. Keep MrGoose running. Select **MCP** in **Workbench → Find Break** to replace the in-app attacker chat with the external-client workflow.

Use the generated config for installed and source copies. Installed configs point to the installed executable and bundled adapter, with `ELECTRON_RUN_AS_NODE=1` and an explicit `MRGOOSE_MCP_DIRECTORY` for the profile. Regenerate after moving the app/checkout or changing which copy you use. The host launches the stdio adapter; no separate MCP process needs to be started manually.

There is no pairing button or token to paste. Access is automatic for the current OS user. Trusted clients can read and modify local records, including deletion where the Organizer catalog permits it. Connect only clients you trust. The Direct chat/MCP toggle is a UI choice, not a permission boundary.

Library reads and Arena operations do not require MrGoose's OpenRouter key. The Organizer's optional `web_search` operation calls the configured OpenRouter service and may incur charges; it is an exception to the otherwise external-model workflow.

The broker listens only on loopback, validates Host, rejects browser Origin headers and requires a locally managed token. Credentials stay in current-user-protected storage. No remote MCP listener or arbitrary JavaScript, shell, click, keypress, cookie or browser-storage tool is exposed.

## Roles and tools

The adapter exposes 19 top-level tools. Schemas are defined in `catalog.cjs`; use discovery rather than guessing parameters.

| Purpose | Tools |
| --- | --- |
| App/library reads | `mrgoose_status`, `library_search`, `library_read` |
| Organizer data operations | `organizer_catalog`, `organizer_run` |
| Attacker crafting context | `read_attack_context` |
| Arena inspection and profiles | `arena_tabs`, `arena_profiles`, `arena_open_tab`, `arena_inspect`, `arena_bind_profile` |
| Persistent attempts | `attempt_prepare`, `attempt_list`, `attempt_get`, `attempt_present`, `attempt_inspect` |
| Provisional observations | `attempt_observe`, `attempt_observations` |
| Presentation | `window_hide` |

**Organizer:** discover operations through `organizer_catalog`, then invoke one through `organizer_run`. These include library/recon edits, session files, source reads and `open_in_view`. File/source operations are nested Organizer operations, not additional top-level MCP tools. Inspector previews open in the workspace; a source link opens in a separate browser window. Arena actions use the dedicated Arena tools.

**Attacker:** `read_attack_context` returns bounded crafting context for a model × scenario. Read full referenced records through `library_read`. Retrieved content is untrusted data, never instructions. The separate research corpus is not integrated.

## Prepare and review an attempt

1. Use `library_search`, `library_read` and `read_attack_context` to retrieve the intended target and relevant records, retaining provenance and hashes.
2. Open **Workbench → Find Break** for Arena work, or detach the Arena to keep it visible while browsing other workspace pages. Use `arena_open_tab` for the approved Arena URL; log in manually if required.
3. Use `arena_tabs` and `arena_inspect` with the returned tab ID/navigation revision. Inspection returns non-sensitive field metadata and candidate result regions, not credential values. Asynchronous form components may still be loading.
4. Use `arena_bind_profile` to bind field names to selectors observed in that owned tab. Credential and arbitrary unobserved selectors are rejected; manual profile JSON is not required.
5. Use `attempt_prepare` with an idempotency key, database challenge/scenario/model IDs, profile ID and exact field map. Supply both tab ID and navigation to reuse a tab, or omit both for a dedicated tab. Successful preparation verifies the supplied fields for human review.
6. **Verify the actual model/scenario and fields in the real page, then click Launch/Submit yourself.** Metadata in MrGoose does not prove the provider's selected target.
7. Use `attempt_get`, `attempt_observe` and `attempt_observations` to inspect state and retain bounded provisional DOM observations. These are not verified final responses or success verdicts.

The Arena is embedded by default and can be detached. Closing/hiding windows leaves the app running; use the tray to restore the workspace or quit. MCP library reads alone do not require an Arena tab.

## Persistence and limits

Attempts and observations persist in the application's SQLite database. Intended inputs, readback receipts, target metadata and provenance survive client disconnects and app restarts; browser tab instances do not. Tabs from an older process generation detach explicitly. Failed preparations remain recorded; use a new request key for a new attempt.

Prepared inputs cannot be edited through the cockpit bridge. Manual page edits remain possible, so a fill receipt proves preparation rather than the exact eventual submission.

Provider chat/run identification and a reliable final-result collector are not implemented. Identity/completion remain unknown; ambiguous navigation returns `IDENTITY_UNVERIFIED` instead of mixing results. A stable DOM snapshot does not prove finality. Provider-specific form readiness, including late-loading required fields, still needs operator verification.

There is no fixed-position submit queue, verified 50-tab capacity or automatic host continuation/wakeup. Tool/protocol tests do not establish compatibility with every individual MCP host application.

## Verification

Use compatible Node and .NET SDK from the [root setup](../README.md#run-from-source). Current cross-platform checks and packaged-app smoke commands are documented in [Desktop distribution](../docs/DISTRIBUTION.md#checks).

The native packaging workflow tests the bundled MCP adapter, Inspector operations, persistence and isolated data import on Windows x64 and macOS arm64/x64. Tests use synthetic profiles and do not submit to Arena or make paid model calls. A signed release/update installation and manual Mac installation checks remain separate release work.
