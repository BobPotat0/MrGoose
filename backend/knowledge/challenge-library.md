# Challenge Library

Where the **objectives** both modes work from are authored. A challenge (e.g. `ipi-black-2026`) holds
**scenarios**, of two types:
- **ipi** — an injection scenario: a benign task the agent is given, the harmful objective, success criteria,
  the **required injection surface** (service/action + named fields), and **markers** (e.g. `{{attacker.email}}`)
  that the harness substitutes with the victim's real value at submission.
- **direct** — a direct-jailbreak behavior: objective + success criteria (+ optional reference / judge context).

Each scenario card shows the **full description**: harmful/benign task, objective, criteria, surfaces, markers,
reference, judge context, known wall, break counts and ids. The operator can create/edit/delete challenges and
scenarios here.

**Your tools (agent):** list_challenges, get_challenge, create_challenge, update_challenge, delete_challenge,
create_scenario, update_scenario, delete_scenario, set_markers (a scenario's injection markers), list_models.
