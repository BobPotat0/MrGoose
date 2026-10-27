# Prompt Library

A file-like **tree of payloads** in folders. Each prompt has: title, folder, tags, verdict
(untested/break/wall/partial), the payload body, and optional **multi-shot follow-up turns** (messages to
send after the opener in a multi-turn attack).

**What the operator can do here:**
- Create folders + prompts; **cut / copy / paste** into folders, **duplicate**, **inline rename** (double-click),
  **search**, **pin folders** (auto-expand), **collapse all**.
- **Undo/redo** the payload body.
- **AI editor** — rewrite the payload (or only the selected span) via OpenRouter.
- **Encoder** (collapsed by default) — the full catalog (~48 transforms, categorized), chainable, and
  `[ENC]…[/ENC]` span-scoped. Encode the whole payload or only a selected span.
- **Export / import** the whole library as JSON.

**Your tools (agent):** list_prompts, create_prompt, update_prompt, delete_prompt, move_prompt,
duplicate_prompt, set_prompt_followups (multi-shot turns), create_folder, list_folders, rename_folder,
delete_folder, list_encoders, encode_chain. To *show* a prompt to the operator, `open_in_view(kind:"prompt", id)`
(opens it live-editable in the Inspector) rather than pasting its body into chat.

Prompts marked here are also the source for the Break Workbench's **"break from prompt library as reference"**
picker (break-verdict prompts first).
