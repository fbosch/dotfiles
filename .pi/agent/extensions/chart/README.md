# Chart extension

The enabled chart extension registers fifteen focused specialist tools:

- `chart_pie` renders labeled nonnegative values as a pie chart.
- `chart_bar` renders labeled signed values as a horizontal bar chart.
- `chart_line` renders numeric or temporal points as a single-series line chart. It accepts `null` y values as gaps and optional `markers`.
- `chart_scatter` renders one numeric x/y series as uniform, fixed-size dots. Points retain their input order; unordered and duplicate coordinates are valid. Optional point `label` values are shown beside their dots.
- `chart_histogram` bins raw numeric samples into a count histogram.
- `chart_bezier` renders one exact cubic Bézier segment from four x/y points.
- `chart_heatmap` renders a labeled numeric matrix with explicit missing cells.
- `chart_boxplot` compares labeled sample distributions with horizontal boxes and whiskers.
- `chart_waterfall` shows a starting value, signed changes, and a calculated final total.
- `chart_dumbbell` compares two values per labeled row with connected dots.
- `chart_stacked_bar` compares nonnegative compositions across labeled categories.
- `chart_gantt` renders deterministic task timelines with progress, milestones, and dependency connectors.
- `chart_network` renders deterministic layered directed networks and call graphs, including multiple parents, disconnected nodes, cycles, self-loops, and duplicate display labels.
- `chart_tree` renders tidy parent-child hierarchy trees for repository, AST, dependency, and task structures.
- `chart_treemap` compares hierarchical bundle, directory, or module sizes by area.

All fifteen tools accept an optional `maxHeightCells` value from 8 through 64. It sets an upper bound on the rendered height in terminal cells. Omit it to keep the chart's existing default sizing. Charts that need compaction keep every row, node, task, or category and reduce available spacing instead of dropping data.

The extension registers tool metadata and public TypeBox schemas eagerly, but `chart_*` tools are specialist tools deferred from the initial active set. Use `search_tools` to discover and activate them. The shared renderer (`types.ts`) and the requested chart adapter are loaded only when that chart is executed or replayed. Concurrent requests share the same cached import promise. A failed import is cached and reported as a stable chart-unavailable error rather than retried on every render.

Result rendering remains synchronous for Pi. The result slot starts loading on its first render, keeps the self-shell empty while the module loads, and invalidates the row when the chart component is ready. The wrapper keeps the latest width and theme, so a resize or theme change during loading does not render stale output. Replay selects the adapter from saved details, falling back to the tool name. Pie details saved before chart type metadata existed remain supported by `chart_pie`.

`toolDiscovery.deferredToolPrefixes` in `.pi/agent/settings.json` controls which tool-name prefixes are treated as specialist tools. The default configuration includes `chart_`, `figma_`, `serena_`, `context7_`, `ast-grep_`, and `mcp__`.

## Line charts

`chart_line` requires `xType`. `numeric` uses finite numeric `x` values; `temporal` uses UTC ISO dates (`YYYY-MM-DD`) or UTC datetimes ending in `Z`. Points must be strictly increasing. `y` values are finite numbers or `null`; a `null` creates a gap.
Numeric line charts accept optional `xFormat` and `yFormat`. Numeric x values support both formats; temporal x values support `yFormat` only. Each accepts `"number"` (the default) or `"percent"`. Percent formatting treats each input as a fraction and multiplies it by 100, so `0.667` is displayed as `66.7%`; it does not change stored data, geometry, or summaries.

## Scatter charts

`chart_scatter` accepts between 2 and 200 rows of `{ x, y, label? }`. Both positions must be finite numbers. `title`, `xLabel`, and `yLabel` are optional. It has no series, grouping, color, or bubble-size channels.
`xFormat` and `yFormat` optionally accept `"number"` (the default) or `"percent"`. Percent formatting treats each coordinate as a fraction and multiplies it by 100 for axis labels only; it does not change point positions or stored values.
The following charts accept `valueFormat`: `chart_bar` formats row values; `chart_boxplot`, `chart_waterfall`, and `chart_dumbbell` format numeric axis ticks (and dumbbell difference annotations); `chart_heatmap` formats visible cell values and color-scale endpoints. The options use the same `"number"`/`"percent"` behavior. `chart_stacked_bar` already uses percent ticks when `normalize` is `true`, so it has no redundant format option.

## Histograms

`chart_histogram` accepts `data` as 1–200 finite numeric samples. Optional `bins` is an integer from 1 through 50. The default is `ceil(sqrt(sample count))`, capped at 50. Optional `title` is 1–80 characters; `xLabel` and `yLabel` are 1–40 characters. Labels are trimmed and cannot be blank. The Y axis always shows integer counts and defaults to the label `Count`.

Bins divide the observed minimum-to-maximum range equally. Each interval includes its lower boundary and excludes its upper boundary, except the last bin, which includes the maximum. Exact internal boundaries go to the bin on their right. Negative samples and duplicates are retained; input order does not affect counts. Empty bins are retained.

Constant samples use one centered bin, even when `bins` is supplied, with padding `max(0.5, abs(value) * 0.01)` on each side. Ranges that overflow, or bin boundaries that collapse at floating-point precision, fail explicitly. Rescale the samples or request fewer bins. Text summaries and saved details retain exact computed boundaries and counts; axis ticks are abbreviated for display.

```json
{ "data": [-2, -1, 0, 0, 2], "bins": 4, "title": "Samples", "xLabel": "Value" }
```

This produces counts `1, 1, 2, 1` for `[-2, -1)`, `[-1, 0)`, `[0, 1)`, and `[1, 2]`.

## Bézier charts

`chart_bezier` requires `start`, `control1`, `control2`, and `end`, each an object with finite numeric `x` and `y` coordinates from −1,000,000,000 through 1,000,000,000. These define one cubic segment, not samples to interpolate. The SVG contains one `M … C …` path using the supplied controls.

`showControls` defaults to `false`. Set it to `true` to show two subtle endpoint-to-control guides and control-point markers. Endpoint markers remain visible, including when all four points coincide. Optional `title` is 1–80 characters; `xLabel` and `yLabel` are 1–40 characters. Labels are trimmed and cannot be blank.

```json
{
  "start": { "x": 0, "y": 0 },
  "control1": { "x": 4, "y": 8 },
  "control2": { "x": -4, "y": 8 },
  "end": { "x": 2, "y": 0 },
  "showControls": true
}
```

Both axes use the same pixels per unit, preserving angles and proportions at different terminal sizes. The viewport includes all four points even when controls are hidden, so toggling guides does not change the curve. Straight, horizontal, vertical, closed, and coincident segments are valid. Near-coincident and subnormal ranges receive minimum viewport padding to avoid floating-point collapse; the stored coordinates are unchanged.

The default presentation is a compact square with minimal padding and no axes, ticks, or visible title. Explicit titles and axis labels reserve their own space outside the square plot. The plot is capped at ten terminal rows in physical pixels and shrinks to fit the available width.

Bézier rendering uses the installed `@tanstack/charts` scene and SVG renderer: a scene path carries the exact cubic, `dot` marks render endpoints, and scene rules and dots render optional controls. The shared worker rasterizer, full-resolution output, cached image identities, and resume queue timeout handling are unchanged.

## Heatmaps

`chart_heatmap` requires `rows` and `columns`, each containing 1–12 labels of 1–22 characters. Labels are trimmed and must be nonblank and unique within their axis after trimming. Input order is preserved: rows run top to bottom, columns left to right. `data` must be a rectangular `number | null` matrix matching both label arrays, with at most 144 cells. Numeric values must be finite and between −1,000,000,000 and 1,000,000,000 inclusive. `null` means missing, never zero; missing cells use a gray hatch and a separate legend key. For readable output, prefer modest row/column counts and bounded value ranges; normalize or summarize extreme dynamic ranges.

`colorScale` defaults to `sequential`, a light-to-dark blue ramp across the observed numeric minimum and maximum. `diverging` uses blue for negative values, a light midpoint at zero, and red for positive values, with domain `[-max(abs(values)), max(abs(values))]`. Nulls do not affect either domain. Constant sequential data and zero-only diverging data use the midpoint color and one labeled constant swatch rather than a fictional range. Constant nonzero diverging data retains its symmetric domain. All-null data shows only missing cells and `No numeric data`, without a numeric ramp.

`showValues` defaults to `false`. Set it to `true` for matrices with at most 36 cells; larger requests fail validation. Visible values are abbreviated, and omitted when cells cannot fit them at the configured font size. The SVG description and tool text retain every exact value and full label, including explicit missing entries. Long visible labels and titles are shortened with an ellipsis to fit. Height grows with row count and the configured font size so row labels remain readable; the 12-row limit bounds it. Optional `title` is 1–80 characters, trimmed and nonblank.

```json
{
  "rows": ["North", "South"],
  "columns": ["Mon", "Tue", "Wed"],
  "data": [[-2, 0, null], [1, 2, 4]],
  "colorScale": "diverging",
  "showValues": true,
  "title": "Daily change"
}
```

TanStack scenes, rectangle marks, and its SVG renderer own all cell geometry. Heatmaps use the same lazy loading, font settings, full-resolution worker rasterizer, cached image identities, and resume deadlines as the other charts. Saved details contain the trimmed labels, exact matrix, resolved scale and value-display options, and shared chart settings; domains are recomputed on replay.

## Box plots

`chart_boxplot` requires `groups`, an array of 1–12 `{ label, values }` objects. Each label is 1–22 characters, trimmed, nonblank, and unique after trimming. Each `values` array contains 1–200 finite numbers between −1,000,000,000 and 1,000,000,000 inclusive. Groups appear top to bottom in input order. Optional `title` is 1–80 characters; `xLabel` and `yLabel` are 1–40 characters. All text is trimmed and cannot be blank. The X axis represents sample values; the Y axis represents groups.

Quartiles use linear interpolation, quantile type 7. Sort each group's samples ascending, compute zero-based rank `h = (n - 1) * p`, then interpolate between samples at `floor(h)` and `ceil(h)`. Q1, median, and Q3 use `p = 0.25, 0.5, 0.75`. For `[0, 1, 2, 3]`, they are `0.75, 1.5, 2.25`. The box spans Q1 through Q3 with a median line. Whiskers end at the smallest and largest actual samples inside the inclusive fences `Q1 - 1.5 * IQR` and `Q3 + 1.5 * IQR`, where `IQR = Q3 - Q1`. Samples outside the fences are outliers.

`showOutliers` defaults to `true`. Hiding dots does not change the domain: all samples, including outliers, remain within its padded range. Coincident outlier dots overlap; statistics retain duplicate samples. Singleton and constant groups collapse to a visible median/cap line without inventing spread. Two-point groups use the same interpolation rule. Display padding is `max(span * 0.05, abs(min) * 1e-12, abs(max) * 1e-12, 1e-12)` on each side, including constant and subnormal ranges.

```json
{
  "groups": [
    { "label": "Before", "values": [0, 1, 2, 3, 4, 100] },
    { "label": "After", "values": [1, 2, 2, 3] }
  ],
  "title": "Latency distribution",
  "xLabel": "Milliseconds",
  "showOutliers": true
}
```

TanStack rectangle and dot marks, scene rules, and its SVG renderer own the plot geometry. Redundant per-dot metadata and fill attributes are removed from the resulting SVG to keep the maximum outlier payload within the shared worker's 64 KiB input limit. Dot coordinates are unchanged. Saved details contain normalized labels, original samples, resolved `showOutliers`, and shared chart settings; statistics are recomputed on replay. Text summaries retain full labels, exact quartiles, whiskers, extrema, sample counts, and outlier counts. Visible labels are shortened to fit, and numeric ticks are abbreviated. Height grows with group count and configured font size.

Box plots use the existing lazy loader, full-resolution raster worker, cached image identities, and per-render queue deadlines. No raster scheduling or cache behavior changes are required.

## Waterfalls

`chart_waterfall` requires `start` and `deltas`, an ordered array of 1–12 `{ label, value }` objects. Start, each signed delta, and every running total must be finite numbers within ±1,000,000,000. Labels are 1–22 characters, trimmed and nonblank; repeated labels are allowed because each step has its own position. Optional `title` is 1–80 characters; `xLabel` and `yLabel` are 1–40 characters. All text is trimmed and cannot be blank. X represents cumulative value and Y represents steps.

```json
{
  "start": 100,
  "deltas": [{ "label": "Sales", "value": 40 }, { "label": "Costs", "value": -25 }],
  "title": "Balance changes",
  "xLabel": "Amount"
}
```

This produces Start `100`, Sales `100 → 140`, Costs `140 → 115`, and Total `115`. The final total is calculated; callers cannot override it. Arithmetic uses JavaScript numbers in input order without intermediate rounding. Text summaries retain the exact numbers, signed deltas, and every before/after total. Saved details contain the normalized input and chart settings; replay validates them and recomputes totals.

Horizontal bars run top to bottom with connectors at the preceding running total. Start and Total bars extend from zero, including negative totals. Blue means increase, orange means decrease, and the foreground color identifies Start, Total, and zero changes. The legend describes direction, not whether a change is good or bad. Zero-width bars receive a visible rule at their exact position.

The domain includes zero and every intermediate total, with padding `max(span * 0.05, 1e-12)` on both sides. This also handles zero-only and subnormal data. Visible ticks are abbreviated to three significant digits and labels are shortened to fit. Height grows with the number of steps and configured font size. TanStack rectangle marks, scene rules, and its SVG renderer own plot geometry. Waterfalls use the shared lazy loader, full-resolution raster worker, cached image identities, and resume queue deadlines unchanged.

## Dumbbell charts

`chart_dumbbell` requires `data`, an array of 1–12 `{ label, before, after }` objects. Labels are 1–22 characters, trimmed, nonblank, and unique after trimming. Both coordinates must be finite numbers within ±1,000,000,000. Rows remain independent and run top to bottom in input order. X represents value; Y represents labeled rows. Unknown fields and a caller-supplied `type` are rejected.

Optional `beforeLabel` and `afterLabel` name the series and default to `Before` and `After`. Each is 1–22 characters. Optional `title` is 1–80 characters; `xLabel` and `yLabel` are 1–40 characters. Text length bounds apply before trimming; all supplied text is trimmed and cannot be blank.

`showDifferences` defaults to `false`. When true, each row reserves a separate line for `Δ after - before`, signed with `+` for positive differences, `-` for negative differences, and `0` for equality. Differences are absolute changes, not relative percentages; with `valueFormat: "percent"`, they are displayed as percentage-point changes. They may reach ±2,000,000,000. Arithmetic uses JavaScript numbers without intermediate rounding. Narrow displays shorten annotations with an ellipsis or omit them when no character fits. The SVG description and tool summary always retain full labels, both exact values, and exact signed differences, even when visible differences are disabled. Zero values are retained.

```json
{
  "data": [
    { "label": "North", "before": -10, "after": 20 },
    { "label": "South", "before": 5, "after": 5 }
  ],
  "beforeLabel": "Baseline",
  "afterLabel": "Current",
  "showDifferences": true,
  "xLabel": "Value"
}
```

Blue open rings identify the before series and smaller orange dots identify the after series, with a two-entry legend. Colors identify series, not improvement or deterioration. Equal values share the same position; the orange dot remains visible inside the blue ring. A neutral connector joins each pair without connecting separate rows.

The domain covers both series with padding `max(span * 0.05, abs(min) * 1e-12, abs(max) * 1e-12, 1e-12)` on both sides. It does not force zero into the range. Constant, negative-only, and subnormal values remain valid. Marker gutters prevent endpoint clipping. Labels shorten to fit, tick count decreases at narrow widths, and row height grows with the configured font size and difference visibility.

TanStack dot marks, scene rules, and its SVG renderer own the plot. Saved details contain normalized input, resolved series names and `showDifferences`, and shared chart settings. Replay revalidates details and recomputes the domain and differences. The lazy loader, full-resolution worker rasterizer, cached image identities, and resume queue deadlines are unchanged.

## Stacked bar charts

`chart_stacked_bar` requires `categories` (1–12 labels) and `series` (1–6 `{ name, values }` objects). Each values array must match the category count. Category labels and series names are 1–22 characters, trimmed, nonblank, and unique within their respective arrays after trimming. Categories run top to bottom; series stack left to right and appear in the legend in input order. X represents value and Y represents category.

Values must be finite numbers from 0 through 1,000,000,000 inclusive. These are nonnegative composition values, not signed changes; use `chart_waterfall` for signed cumulative changes. Each category total must be finite and can reach 6,000,000,000. Totals use JavaScript addition in series order without rounding.

```json
{
  "categories": ["North", "South", "No sales"],
  "series": [
    { "name": "Online", "values": [1, 6, 0] },
    { "name": "Store", "values": [3, 2, 0] },
    { "name": "Other", "values": [0, 0, 0] }
  ],
  "xLabel": "Sales"
}
```

`normalize` defaults to `false`. The example uses a raw domain of `[0, 8]`, with category totals 4, 8, and 0. Set `normalize: true` to display each nonzero total as 100% on a `[0, 100]` domain with percent ticks: North becomes 25% Online and 75% Store, South becomes 75% Online and 25% Store. Zero totals stay zero without division. Zero segments have zero width; their series remain in the legend. An all-zero raw chart uses `[0, 1]` without inventing nonzero bars.

Optional `title` is 1–80 characters; `xLabel` and `yLabel` are 1–40 characters. Text bounds apply before trimming; supplied text cannot be blank. Unknown fields and a caller-supplied `type` are rejected. Visible labels are shortened or omitted when space is insufficient, tick count decreases at narrow widths, and each legend entry gets its own line. Colors identify series consistently across rows, including all-zero series. The SVG description and tool summary always retain full labels, exact raw values, and exact raw category totals, even in normalized mode.

TanStack scenes, rectangle marks with zero inset, linear scales, and its SVG renderer own bar geometry. Unit coordinates protect subnormal raw domains from scale overflow. Saved details contain trimmed labels, original values, resolved `normalize`, and shared chart settings; replay revalidates them and recomputes stacks and totals. The lazy loader, full-resolution worker, cached image identities, and resume queue deadlines are unchanged.


## Gantt charts

`chart_gantt` requires `tasks`, an ordered array of 1–64 task intervals. Each task has a unique trimmed `id`, a trimmed `label`, finite bounded `start` and `end` values with `start < end`, and optional `group`, `progress` from 0 through 1, and up to eight task IDs in `dependencies`. Optional `milestones` contain a trimmed `label` and finite bounded `at` value. `title` and `xLabel` are optional. Unknown fields and a caller-supplied `type` are rejected. For readable output, prefer about 16 tasks and modest milestone counts, especially with `maxHeightCells`.

```json
{
  "tasks": [
    { "id": "scan", "label": "Scan repository", "start": 0, "end": 3, "progress": 1 },
    { "id": "index", "label": "Build index", "start": 2, "end": 6, "group": "analysis", "progress": 0.5, "dependencies": ["scan"] }
  ],
  "milestones": [{ "label": "Release", "at": 7 }],
  "title": "Repository plan",
  "xLabel": "Day"
}
```

Task order is authored order. TanStack rectangle marks render the interval and completed portion; text marks show progress when the interval is wide enough. Dependency paths, milestone diamonds, grid lines, labels, and the timeline shell are deterministic SVG overlays. Height caps compact the row pitch; progress, group, and task labels are omitted when they would overlap. The summary and SVG description retain exact normalized task values, dependencies, and milestones even when visible labels are shortened or omitted.

## Layered network and call-graph charts

`chart_network` accepts `nodes` and `edges`. There must be 1–64 nodes and at most 128 directed edges. Each node has a unique trimmed `id`, a trimmed `label`, and an optional trimmed `group`. Each edge references existing node IDs and may have a trimmed `label`. Duplicate directed edges are rejected. Empty edge lists, multiple parents, disconnected nodes, duplicate display labels, cycles, and self-loops are valid. Optional `title` is 1–80 characters. `maxHeightCells` optionally caps the rendered height at 8–64 terminal cells; when omitted, the natural network height is used. For readable output, prefer about 12 nodes and 25 edges or fewer; dense reciprocal or self-loop graphs can overlap, so use short labels or split the graph.

```json
{
  "nodes": [
    { "id": "cli", "label": "CLI", "group": "frontend" },
    { "id": "parser", "label": "Parser", "group": "backend" },
    { "id": "shared", "label": "Shared" }
  ],
  "edges": [
    { "source": "cli", "target": "parser", "label": "calls" },
    { "source": "cli", "target": "shared" },
    { "source": "parser", "target": "shared" }
  ],
  "title": "Call graph",
  "maxHeightCells": 32
}
```

The layout is deterministic and does not use force simulation. Strongly connected components are condensed for layering, so cycles stay together while acyclic component links grow from left to right. Nodes within a layer retain authored node order. Forward links use scene lines; backward links, same-layer links, and self-loops use stable curved paths with arrowheads. Same-layer and self-loop paths are dashed. Group colors follow first appearance order.
Broad layers expand vertically when no cap is requested. A height cap compacts node positions while preserving order; labels are omitted when the available vertical or horizontal space is too small, and dense graphs omit edge labels rather than stacking unreadable text.

Labels are shortened with an ellipsis when the available gap is too small. Edge labels are included when they fit and graph density allows. The exact node IDs, labels, groups, edge endpoints, and edge labels remain in the text summary and bounded SVG accessibility description. Replay revalidates the saved graph before rebuilding the same layout.

## Tidy hierarchy trees

`chart_tree` accepts `data`, an array of 1–64 flat `{ id, parentId?, label }` nodes. IDs are trimmed, nonblank, unique, and at most 120 characters; labels are trimmed, nonblank, and at most 40 characters. The rows must form one connected acyclic hierarchy with exactly one root. An explicit `null` `parentId` is also accepted for the root. Optional `title` is 1–80 characters and is trimmed and nonblank. For readable output, prefer about 32 nodes or fewer and split broad or deep hierarchies; use short labels.

```json
{
  "data": [
    { "id": "repo", "label": "Repository" },
    { "id": "src", "parentId": "repo", "label": "src" },
    { "id": "tests", "parentId": "repo", "label": "tests" },
    { "id": "parser", "parentId": "src", "label": "parser.ts" }
  ],
  "title": "Repository"
}
```

The installed TanStack `hierarchy/tree` transform computes a deterministic tidy layout. The adapter renders parent-child links first, then nodes and labels, with the root at the left and descendants growing to the right. Labels are fitted to their available parent-to-child gap and the plot boundary, and overlapping labels are omitted; outgoing links are offset beyond the source label when space permits, so connectors do not paint through text or dots. Input order controls sibling order. The text summary and bounded SVG description retain every exact ID, parent relationship, and label.

## Treemaps

`chart_treemap` accepts `data`, an array of 1–6 top-level nodes. Each node has a `label` and exactly one of `value` or nonempty `children`. Labels are 1–22 characters, trimmed, nonblank, and unique among siblings after trimming. The tree has at most 64 nodes and four levels, counting top-level nodes as level one. The provider schema unrolls these levels without recursive references. A bounded traversal checks execution and replay inputs before schema validation. For readable output, use short labels and balanced values; extreme value skew makes small tiles disappear.

```json
{
  "data": [
    { "label": "src", "children": [
      { "label": "core", "children": [
        { "label": "parse.ts", "value": 24 },
        { "label": "render.ts", "value": 16 }
      ] },
      { "label": "empty.ts", "value": 0 }
    ] },
    { "label": "vendor", "value": 60 }
  ],
  "title": "Bundle sizes",
  "unit": "kB"
}
```

Leaves contain finite nonnegative numbers. Parents sum their children using JavaScript numbers without intermediate rounding; callers cannot supply parent values. Each aggregate and the overall total must be finite. All-zero trees are rejected with `treemap requires at least one positive leaf value`. Zero leaves retain their exact entries in the summary but consume no area. Optional `title` is 1–80 characters and `unit` is 1–22; both are trimmed and nonblank. Length bounds apply before trimming. Unknown fields, null values, and caller-supplied `type` are rejected.

The installed TanStack `hierarchy/treemap` mark owns squarified tiling, parent containment, and fitted in-cell labels. The adapter supplies opaque positional node IDs, explicit parent IDs, and zero contributions for structural nodes, preventing double-counting. Leaf contributions are divided by the total for layout arithmetic; raw values remain unchanged. Authored sibling order is preserved. Native pixel rounding prevents floating-point edge overshoot from failing TanStack’s strict bounds check. Pixel rounding can hide subpixel leaves, and extreme ratios can underflow; neither changes the saved data or exact summary.

Colors identify top-level groups in input order, including zero-valued groups in the legend. Tiles show hierarchical paths and sizes rounded to three significant digits when the label fits. TanStack omits labels that do not fit, and scene clip groups keep retained labels inside their own tiles when font substitution differs from text measurement. Legend entries occupy separate lines and shorten at narrow widths. The summary and SVG description retain every complete path as a JSON label array, each exact leaf value and parent total, and the overall total. Units are labels only; values are not converted.

TanStack scenes and its SVG renderer feed the existing lazy loader and full-resolution worker. Saved details contain normalized input and shared font settings; replay validates the hierarchy and recomputes totals and layout. Raster scheduling, cached image identities, and resume deadlines are unchanged.

## Font configuration

Configure `charts.fontFamily` and the optional `charts.fontSize` in global `~/.pi/agent/settings.json`, or in a trusted project's `.pi/settings.json`. Project values override global values. `fontSize` is a logical-pixel number from `8` through `32`; when omitted, every chart keeps its existing built-in text sizes.

```json
{
  "charts": {
    "fontFamily": "Zenbones Brainy",
    "fontSize": 14
  }
}
```

Invalid chart settings fail the tool call.

## Rendering

Charts use bundled async `@resvg/resvg-js`. Font resolution, raster cache behavior, theme rendering, cancellation, and the ten-second timeout are shared across all chart tools.

## Startup measurement

The following cold-process measurement used five fresh Bun subprocesses per case. Each subprocess preloaded `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`, and `typebox/value`, then loaded the chart extension through Pi's extension loader. The extension interval is the time from host preload to extension registration completion. RSS is a rough process-memory delta, not an allocation profile. The before values are the baseline captured before this refactor; the after values were rerun with the same harness.

| Metric                    | Before lazy loading | After lazy loading |
| ------------------------- | ------------------: | -----------------: |
| Extension interval median |             35.9 ms |             5.0 ms |
| RSS delta median          |          10,012 KiB |          1,140 KiB |

The measurement covers extension import and registration, not full interactive Pi startup or first-chart latency. The first chart still pays for the shared renderer and the selected adapter when it is actually needed.
