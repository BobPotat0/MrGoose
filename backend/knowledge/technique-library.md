# Technique Library

The Gray-Swan jailbreak / IPI technique catalog. Color-coded by tactic with exactly **3 tags**:
- **direct** — the attack is the message you send the model (direct chat jailbreak).
- **indirect** — the attack hides in content the agent reads (indirect prompt injection).
- **encoding** — obfuscates the trigger via an encoding / cipher / token smuggling.

**5 built-in techniques** (read-only, restored on "reset built-ins"):
1. Forged instructor / system-reminder (indirect) — forged `<system-reminder>` as authorized measurement.
2. Sandbox / Test-Control reframe (indirect) — isolated-simulation + pre-approval reframe.
3. Confused-deputy feature reframe (indirect) — harmful action as an explicitly-requested feature.
4. Refusal suppression / Skeleton Key (direct) — ban refusal; disclaimer-then-answer.
5. Encoding / token smuggling (encoding).

The operator can add their own techniques, tag them, edit the tag registry (colors), filter + search,
import/export JSON, and reset built-ins. Each technique shows in 3 columns: name+tags · description · example.

**Your tools (agent):** show_techniques (opens a read-only snapshot table in chat), list_techniques, create_technique, update_technique, delete_technique
(built-ins are read-only and cannot be deleted).
