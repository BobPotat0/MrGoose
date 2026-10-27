# Inspector (Organizer right column)

The Organizer's right column has a fixed **Files** panel on top and the **Inspector** below it. The Inspector
is a shared viewer/editor: a **stack of open items**, shown one at a time.

**What you put there — `open_in_view(kind, id)`:**
Call it whenever the operator asks you to *show / display* something, or **just before you edit** an item, so
they can see and live-edit it.
- `kind:"technique"` — opens the technique, live-editable (title / summary / example / tags).
- `kind:"prompt"` — opens the prompt, live-editable (title / body / tags / scenario).
- `kind:"file"` — opens a session file, editable text (+ markdown preview for `.md`).
- `kind:"source-doc"` — opens a Source document in a reader (PDF reader for PDFs; text/markdown otherwise).
- `kind:"source-link"` — opens the link in a **separate browser window** (not the Inspector).

**Behavior the operator sees:**
- Multiple open items → **prev / next** arrows with an **"N / M"** counter, plus **close** / **close all**.
- Techniques, prompts and files are **live-editable** and save back to the library (built-in techniques are
  editable here in the UI; your `update_technique` tool still treats built-ins as read-only — use
  `reset_techniques` to restore shipped defaults). Source docs/links are view-only.
- An **"↗ library"** button jumps from an item to its library page.
- When you (or an external MCP client) open or change an item, it reflects in the Inspector **live** — so
  `open_in_view` is the right way to "show" the operator what you are working on.
- If the Organizer tells the whole Technique library, each technique row is clickable to open in the Inspector.

**Rule of thumb:** don't paste a technique/prompt/file's full body into chat just to "show" it — `open_in_view`
it instead, then describe or edit it.
