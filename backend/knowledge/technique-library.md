# Technique Library

The Gray-Swan jailbreak / IPI technique catalog. Color-coded by tactic with exactly **3 tags**:
- **direct** — the attack is the message you send the model (direct chat jailbreak).
- **indirect** — the attack hides in content the agent reads (indirect prompt injection).
- **encoding** — obfuscates the trigger via an encoding / cipher / token smuggling.

**5 built-in techniques** (the operator can edit them in the UI / Inspector; "reset built-ins" restores the
shipped defaults — your `update_technique`/`delete_technique` tools still treat built-ins as read-only):
1. Forged instructor / system-reminder (indirect) — forged `<system-reminder>` as authorized measurement.
2. Sandbox / Test-Control reframe (indirect) — isolated-simulation + pre-approval reframe.
3. Confused-deputy feature reframe (indirect) — harmful action as an explicitly-requested feature.
4. Refusal suppression / Skeleton Key (direct) — ban refusal; disclaimer-then-answer.
5. Encoding / token smuggling (encoding).

The operator can add their own techniques, tag them, edit the tag registry (colors), filter + search,
import/export JSON, and reset built-ins. Each technique shows in 3 columns: name+tags · description · example.

**To show a technique to the operator**, `open_in_view(kind:"technique", id)` opens it live-editable in the
Inspector (preferred over `show_techniques`, which only prints a snapshot table in chat). When you list the
whole catalog, the rows are clickable to open in the Inspector.

**Your tools (agent):** list_techniques, show_techniques (snapshot table in chat), create_technique,
update_technique, delete_technique (built-ins read-only / undeletable via tools), reset_techniques, plus the
tag tools list_technique_tags / save_technique_tag / delete_technique_tag. New technique from research:
web_search (or read_source a Source doc) → create_technique, tagged direct/indirect/encoding.
