# Chart visual-validation fixtures

`manifest.json` is the frozen, replayable matrix for the sixteen public `chart_*` tools. It is a test plan, not a collection of generated images: every case keeps exact public arguments inline, and every case starts with a pending artifact ledger. Do not edit a rejected case to make it easier to render; fix the renderer or record the blocker.

## Profiles and themes

- `D` (default): 60 terminal columns × 9 px cell width × 18 px cell height, natural height.
- `N` (narrow): 28 terminal columns × 9 px × 18 px, natural height.
- `D18`: the default width with `maxHeightCells: 18`.
- `N8`: the narrow width with `maxHeightCells: 8`.

A case's `args` are the exact discriminator-free public arguments. A `heightCaps` entry is a deterministic replay variant: merge its `maxHeightCells` into the base `args` and render it at the named profile. Natural views must not inherit a cap. The required theme is `dark`, using the current Pi dark theme; record the concrete theme/version used in the ledger.

## Case contract

Each chart has a representative case and an adversarial case. Each case contains:

- `args` — inline JSON accepted by the named public tool (or, in future cases, a deterministic `generator` instead, never both).
- `profiles` and optional `heightCaps` — natural and compact views to replay.
- `semanticInvariants` — facts that must remain true after parsing and rendering.
- `objectiveCheckIds` — deterministic checks from the manifest's `objectiveChecks` catalog; these complement visual review.
- `visibleInfo` — required visible conclusions and omissions allowed only by the renderer's documented compaction rules.
- `ledger` — intentionally empty result slots. A validator appends one view record per profile/theme with status, attempts, artifact path, and corrected defects. PNGs and bulky run results do not belong in this directory.

The exact source data, ordering, relationships, units, and accessibility/text summary are always required even when a visible label is shortened or omitted. `validated` requires an actual rendered image to be inspected; syntax, SVG strings, summaries, and tool success alone are not visual evidence. Use at most three render/inspect attempts per view unless the parent authorizes more. A missing renderer or unresolved defect is `blocked`, not a pass.

## Replay workflow

1. Read one case and materialize its base `args` unchanged; for a cap, apply only the declared height override.
2. Call the named public tool at every listed profile/theme. Outside TUI mode, retain the returned PNG and inspect the image at the target dimensions.
3. Check semantics and the listed objective checks, then use `visualizerPromptTemplate` to obtain a separate visual review. Record each view in the case ledger without replacing the frozen input.
4. If a view is rejected, diagnose and fix the renderer, rerender the same arguments, and revalidate at the same profile. Recheck both `D` and `N` after material layout changes.

## Adding fixtures

Keep cases small enough to review, but include the edge that motivated them: missing values, zero/negative values, duplicate or overlapping points, skew, long labels, cycles/self-loops, broad hierarchies, or height compaction. Prefer exact inline arguments over opaque data files. If a generated case is necessary, define a pure, bounded, seeded generator whose output is deterministic and include its expected semantic totals. Never commit generated PNGs or result dumps.

The matrix is deliberately limited to renderer validation. It must not change public data contracts, visualizer acceptance rules, or unrelated extensions.

## Completeness check

From the repository root, the following script validates JSON, required fields, unique IDs, profile references, objective-check references, and coverage of all sixteen tools:

```sh
bun -e '
const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(".pi/agent/extensions/chart/__tests__/fixtures/visual-validation/manifest.json", "utf8"));
const expected = ["pie", "donut", "bar", "line", "scatter", "histogram", "bezier", "heatmap", "boxplot", "waterfall", "dumbbell", "stacked_bar", "gantt", "network", "tree", "treemap"];
if (m.profiles.D.widthCells !== 60 || m.profiles.D.cellWidthPx !== 9 || m.profiles.D.cellHeightPx !== 18 || m.profiles.D.heightMode !== "natural") throw new Error("bad D profile");
if (m.profiles.N.widthCells !== 28 || m.profiles.N.cellWidthPx !== 9 || m.profiles.N.cellHeightPx !== 18 || m.profiles.N.heightMode !== "natural") throw new Error("bad N profile");
if (m.charts.length !== expected.length || JSON.stringify(m.charts.map(x => x.chart)) !== JSON.stringify(expected)) throw new Error("chart coverage/order mismatch");
const ids = new Set();
for (const chart of m.charts) {
  if (chart.tool !== `chart_${chart.chart}` || chart.cases.length < 2) throw new Error(`bad ${chart.chart} entry`);
  for (const c of chart.cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case ${c.id}`); ids.add(c.id);
    if ((c.args === undefined) === (c.generator === undefined)) throw new Error(`case ${c.id}: args/generator`);
    for (const p of c.profiles) if (!m.profiles[p]) throw new Error(`case ${c.id}: profile ${p}`);
    for (const h of c.heightCaps ?? []) if (!m.profiles[h.profile]) throw new Error(`case ${c.id}: cap profile ${h.profile}`);
    for (const id of c.objectiveCheckIds) if (!m.objectiveChecks[id]) throw new Error(`case ${c.id}: check ${id}`);
    if (c.ledger.status !== "pending" || c.ledger.attempts !== 0) throw new Error(`case ${c.id}: non-empty ledger`);
  }
}
console.log(`valid visual-validation manifest: ${m.charts.length} charts, ${ids.size} cases, ${Object.keys(m.objectiveChecks).length} objective checks`);
'
```
