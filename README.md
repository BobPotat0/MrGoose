# MrGoose

A desktop workbench for authorized Gray Swan Arena red-teaming. Organize libraries and recon, craft with the in-app agents or an external MCP client, and prepare attempts in the real Arena.

**MrGoose fills and reads. You verify the target and press Launch/Submit.** Retrieved pages, payloads and imported material are data, never app instructions.

## Install the desktop app

Windows x64, macOS Apple Silicon and macOS Intel packages share one source tree. The backend runtime is bundled: **desktop users do not need Node or .NET**.

Current packages are **unsigned internal-test builds**, available in the artifacts of a successful [Desktop packages workflow run](https://github.com/BobPotat0/MrGoose/actions/workflows/desktop-build.yml). They are not a signed public release.

1. Choose your OS/architecture and extract the downloaded workflow artifact ZIP.
2. **Windows:** run `MrGoose-<version>-win-x64-Setup.exe` and follow the installer.
3. **macOS:** open the matching DMG and drag MrGoose into Applications. Apple signing/notarization and manual Gatekeeper installation checks remain outstanding for public distribution.
4. Launch MrGoose to open the full workspace.

Installation starts with a separate user profile. To bring over a development checkout's database and Arena login, follow the explicit [data import instructions](docs/DISTRIBUTION.md#import-the-existing-checkout) before the installed app's first launch.

## First use

### In-app agents

1. In **Settings**, add your OpenRouter key and choose the models for the in-app agents.
2. Use **Mr Goose Organizer** to work with libraries, sources, session files and recon records.
3. In **Workbench → Find Break**, choose a model/scenario and use **Direct chat** to craft with Mr Goose Attacker.
4. Open the Arena, log in manually and verify the actual model/scenario. Review the prepared fields, then **press the real Arena Launch/Submit control yourself**.
5. Bring the victim response back into the workflow for analysis and record the outcome. MCP observations alone do not establish a final result.

The Arena is embedded by default and can be detached into its own window. Closing a window hides it; use the tray's **Quit MrGoose** to stop the app and backend.

### Connect an external agent through MCP

1. Keep the MrGoose desktop app running.
2. Open **Settings → Local MCP — connect an external agent** and copy **Config (mcpServers)**.
3. Register it in a local MCP client with stdio support. Adapt the surrounding config format if your host requires it, preserving the generated command, arguments and environment.
4. In **Find Break**, select **MCP** when using an external client instead of the in-app attacker chat.

The generated configuration uses the current installed app or checkout and its profile path. No token or API key needs to be pasted into MCP configuration. Local access is automatic for your OS user; connect only clients you trust with your local library and Arena preparation.

The external client supplies its own model. Library and Arena operations do not require a MrGoose OpenRouter key; the Organizer's optional `web_search` operation uses the configured OpenRouter service and may incur charges. **Launch/Submit remains manual in both modes.**

See [MCP setup, tools and limitations](mcp/README.md). The MCP toggle changes the crafting interface; it is not an access-control switch.

## Run from source

Development requires **.NET SDK 10** and a Node version allowed by `client/package-lock.json`: `^22.22.3 || ^24.15.0 || >=26.0.0`. CI uses Node 24.22.1. A .NET runtime alone cannot build the backend.

From the repository root:

```sh
npm ci
npm --prefix client ci
npm --prefix client run build
npm start
```

`npm start` builds the backend and opens the workspace using the built client. For Angular live development, use `npm run dev` instead; it builds the backend, starts the client dev server and launches Electron. The app starts its own backend sidecar.

After source changes, rebuild the client before using `npm start`. Copy MCP configuration from Settings again if you move the checkout or switch between development and installed copies. Quit one copy before starting the other; their default local ports overlap.

## Data and updates

| Runtime | Data location |
| --- | --- |
| Source checkout | `data/desktop`, `data/mcp`, `data/logs`, `data/crashes`; database beside the Debug backend executable |
| Installed Windows app | `%APPDATA%/MrGoose` |
| Installed macOS app | `~/Library/Application Support/MrGoose` |

Installed resources are separate from the database, browser profile and credentials. New installed versions snapshot an existing database before schema changes. Back up the **complete data directory**; OS-protected credentials may require re-entry on another machine or OS. The Windows uninstaller preserves user data.

Settings shows the app version and explicit **check → download → restart to update** controls. A Git push does not update installed apps: updates need a higher-version GitHub Release and its platform metadata. No release feed has been published by this implementation, so an update check may report it unavailable. A signed end-to-end upgrade remains to be tested.

## Build and verify

```sh
# On Windows:
npm run dist:win
# On macOS (native architecture):
npm run dist:mac
# On macOS for Intel:
npm run dist:mac:intel
```

Outputs are in `release/`. Build scripts never publish or install them. See [Desktop distribution](docs/DISTRIBUTION.md) for signing, migration, update publishing and verification commands.

The stack is Electron, Angular 22 and an ASP.NET Core/.NET 10 sidecar with SQLite and SignalR (`CockpitHub`). Native CI builds and launches the packaged app on Windows x64 and macOS arm64/x64, checking UI, MCP, persistence and isolated data import.

Provider run identification and reliable final-response collection are not implemented; observations remain provisional. Automatic MCP-client wakeups and 50-tab capacity are not established. The separate research corpus is not integrated into the app library. Packaging does not add autonomous submission or a swarm.
