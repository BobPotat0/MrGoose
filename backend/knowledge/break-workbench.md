# Break Workbench

The hunt surface. Three tabs:

**Overview** — a break matrix (model × scenario, sorted by field-breaks). Click a cell → opens Find Break with
that model × scenario preselected. Plus the scenario register.

**Recon** — the per-model×scenario **dossier**, a 3-column dashboard (ported from TENEBRIS Analyze):
- Tools & call syntax (notation + result shape + captured fired calls)
- Hard filters + Gates
- System/template tags + Scenario recon (ground-truth facts)
Plus editable meta (scaffold / tool namespace / browser) and add/delete of facts & recon notes.

**Find Break** — the embedded **arena page on the LEFT** (resizable via a drag splitter; log into Gray Swan
once inside the Electron app; the arena can be **detached** into its own window and **docked** back — detach
also frees width for the craft panel), the **Mr Goose Attacker** craft agent on the **RIGHT**. The craft chat
has **stop** / **clear** controls and a **model settings** panel (pick the craft model + edit its system
prompt). Vertical source buttons each open a modal:
Break-from-prompt-library · **Building blocks** (insertable system tags / escapes / reusable blocks, like
TENEBRIS) · Techniques · Tool calls/forge · Markers · System prompt · Encoder.

**Mr Goose Attacker** is the craft role. It runs on the in-app model by default, or an external model can take
it over via the **MCP** toggle (then the in-app transcript hides and the model drives via `read_attack_context`
for the model × scenario crafting context). Fill-only still holds: the human launches/submits.

**The loop (workflow):** the ONE craft chat classifies every operator message —
1. a **victim RUN** → it FIRST analyses the run into the dossier/recon with record_* tools (tools, fired calls,
   filters, gates, system tags, scenario recon), THEN judges break-or-not and crafts the next payload;
2. a **craft/refine request** → it crafts, ending with the bare payload;
3. anything else → it answers like a colleague.

Then: ① craft → ② ⌖pick the target field + "fill →" (optionally encoded; never sends) → ③ the operator
launches/submits by hand → ④ "read back" the agent's reply → ⑤ judge + record break/wall/partial (updates the
matrix + dossier). So every answer is analysed and reconned before the next craft.

**Your tools (agent):** get_dossier, record_dossier, set_verdict, set_dossier_meta; plus the arena page tools
arena_open_tab / arena_fill / arena_read / arena_snapshot (fill + read only — never send).
