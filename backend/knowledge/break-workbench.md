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
once inside the Electron app), the **craft agent on the RIGHT**. Vertical source buttons each open a modal:
Break-from-prompt-library · Building blocks · Techniques · Tool calls/forge · Markers · System prompt · Encoder.

**The loop (workflow):** the ONE craft chat classifies every operator message —
1. a **victim RUN** → it FIRST analyses the run into the dossier/recon with record_* tools (tools, fired calls,
   filters, gates, system tags, scenario recon), THEN judges break-or-not and crafts the next payload;
2. a **craft/refine request** → it crafts, ending with the bare payload;
3. anything else → it answers like a colleague.

Then: ① craft → ② ⌖pick the target field + "fill →" (optionally encoded; never sends) → ③ the operator
launches/submits by hand → ④ "read back" the agent's reply → ⑤ judge + record break/wall/partial (updates the
matrix + dossier). So every answer is analysed and reconned before the next craft.

**Your tools (agent):** get_dossier, record_dossier, set_verdict; plus the arena page tools arena_open_tab /
arena_fill / arena_read / arena_snapshot (fill + read only — never send).
