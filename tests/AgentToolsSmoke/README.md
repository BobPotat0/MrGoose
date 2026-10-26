# Agent tool / history checks

Run from the repository root with compatible Node and the .NET 10 SDK:

```powershell
npm --prefix client test -- --watch=false
dotnet run --project tests/AgentToolsSmoke/AgentToolsSmoke.csproj
npm --prefix client run build
```

The backend console check uses only in-memory SQLite and a custom HTTP message handler. It exercises the real AgentService, OpenRouter SSE parser and AgentHub tool loop; it fails on broadcast events. No real keys, external network requests, operator database access or arena actions are used.

The focused Angular tests cover persistence across store recreation, per-conversation context, deletion, streaming guards/checkpoints/recovery, corrupted/full storage, escaped table rendering, the empty library, and event-listener cleanup. They do not exercise a live model or a real Electron restart. Stored model context retains the existing user/assistant text format; raw provider tool-call/result messages are not persisted or replayed.

Local history belongs to the renderer origin/profile and backend URL. Changing origin or clearing app/browser storage changes/removes the available history. It is separate from the backend Finder session tables.

The full client suite now also covers grouped shell navigation, neutral/manual/legacy titles, Instructions visibility, composer Enter/Shift+Enter/IME handling and page-action handler registration before hub startup.

Session-file checks also cover real local HTTP upload/download against the in-memory test database, UTF-8/line-ending preservation, uploaded vs agent-created metadata, session isolation, filename/size validation, bounded model reads, idempotent schema addition and reopening a temporary on-disk store. Client checks cover CSV quoting/limits, safe previews, stale request handling, file cards, file events and multi-file drag-and-drop. No model provider request leaves the mocked HTTP handler.
