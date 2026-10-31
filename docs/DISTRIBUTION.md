# Desktop distribution

The app uses one source tree. Build on Windows for Windows x64; build on macOS for Apple Silicon or Intel. The scripts never publish or install the result.

## Build

Install a Node version allowed by `client/package-lock.json` and .NET SDK 10, then:

```sh
npm ci
npm --prefix client ci
npm run dist:win
# On a Mac:
npm run dist:mac
npm run dist:mac:intel
```

`MRGOOSE_DOTNET` can select an explicit dotnet executable. The script builds Angular, publishes a self-contained Release backend for the selected runtime and packages the app. End users do not need Node or .NET installed. `release/` contains installers; `build/backend/` is disposable staging. `--publish never` is always passed. The resource allowlist excludes the checkout, research corpus, local profile, database, credentials, logs and scratch files.

`node scripts/build-desktop.cjs win x64 --dir` builds only the unpacked directory for smoke tests.

## Local data

Development retains its existing `data/desktop`, `data/mcp` and backend Debug database. Installed builds store mutable files under the operating system's per-user MrGoose application-data directory:

- Windows: normally `%APPDATA%/MrGoose`.
- macOS: normally `~/Library/Application Support/MrGoose`.

The root contains `mrgoose.db`, `desktop/`, `mcp/`, `logs/`, `crashes/` and, when an existing database is first opened by a new application version, `backups/`. Updates replace application resources, not this directory. The uninstaller is configured to preserve it. Backup creation failure prevents schema changes; backups are not an automatic downgrade mechanism.

`MRGOOSE_DATA_DIR` selects an absolute, separate data root for isolated testing. `MRGOOSE_BACKEND_URL` and `MRGOOSE_RENDERER_PORT` allow test instances to avoid the normal local ports. Installed builds require their bundled renderer and never fall back to an Angular dev server.

### Import the existing checkout

Quit **both** applications first. Import into an empty destination before the installed app's first launch:

```powershell
node scripts/migrate-data.cjs --from D:\MrGoose --to "$env:APPDATA\MrGoose" --backend D:\MrGoose\release\win-unpacked\resources\backend\MrGoose.Backend.exe --apps-closed
```

This uses SQLite's backup API, including committed WAL content, then copies the browser profile and MCP records without caches or stale endpoint/lock files. It refuses nonempty destinations and preserves the source. Files are staged in a separate `.import-<id>` directory and renamed into place only when the import succeeds. A failed import leaves staging for recovery while preserving the destination. Copying a live browser profile is unsupported; the explicit flag acknowledges that both apps were closed.

Windows API keys and browser credentials can be bound to the original OS user/machine. Moving a profile to another OS or machine may require logging in and entering keys again. Treat the data directory and its backups as private.

## Updates and release process

Settings displays the app version and a manual **Check for updates** action. Checking does not download; download does not install. **Restart to update** requires explicit confirmation, closes the backend and browser tabs, and installs the downloaded release. No automatic installation on ordinary quit is enabled.

The configured provider is `BobPotat0/MrGoose` GitHub Releases. A commit or push alone does not update installed apps. A maintainer must create a higher-version release with the installer/archive, `latest.yml` / `latest-mac.yml` and block maps produced by the packaging pipeline. No release has been published by this implementation. A missing/private/inaccessible feed produces an unavailable/error message, not a false up-to-date result. Never embed a GitHub access token in a distributed app; choose a public release feed or an authenticated distribution service if the source repository is private.

`.github/workflows/desktop-build.yml` builds platform artifacts on manual dispatch or version tags. It uploads workflow artifacts only; it does not create releases. Configure signing secrets in the repository before distributing publicly. Mac apps require consistent Developer ID signing and Apple notarization for normal public installation and automatic updates; Windows packages should also be signed. Locally produced unsigned packages are for internal testing. macOS builds and updater installation must be verified on actual Macs.

The validation branch `codex/desktop-distribution` also triggers the workflow on push. Apple Silicon uses `macos-15`; Intel uses `macos-15-intel`. Each job verifies its native architecture, runs backend/client checks, builds its package and launches the actual packaged application for UI, local-data import and restart checks. Mac checks additionally verify that startup creates an OS-wrapped key and restart reuses it. Smoke artifacts contain reports, screenshots and logs from synthetic test profiles; databases, credentials and wrapped keys are excluded. A CI pass does not replace manual DMG/Gatekeeper/Keychain interaction checks or a signed upgrade test.

New macOS API keys use AES-GCM with a random key wrapped by Electron's OS Keychain-backed safeStorage API. Only the wrapped key is persisted; the unwrapped key is supplied to the local sidecar at launch. Missing secure storage fails closed. Windows retains DPAPI. Legacy stored formats remain readable for migration; they are not silently rewritten. Back up the complete data root, not just SQLite, on platforms using the wrapped key.

## Checks

```sh
node --test tests/runtime-paths.test.js tests/startup.test.js tests/cockpit-server.test.js tests/distribution.test.js
node --check electron/main.js
npm --prefix client test -- --watch=false
dotnet run --project tests/AgentToolsSmoke/AgentToolsSmoke.csproj
dotnet run --project tests/AttackerCancellationSmoke/AttackerCancellationSmoke.csproj
# After building Windows, with compatible Node:
node tests/packaged-smoke.cjs
# Test an actual installed copy, including routes, Inspector and the real feed check:
node tests/packaged-smoke.cjs "C:/path/to/installed/MrGoose.exe" --ui --check-feed
```

Arena operations remain fill/read only. Packaging does not enable automated submission, strategy changes, corpus integration or a swarm.
