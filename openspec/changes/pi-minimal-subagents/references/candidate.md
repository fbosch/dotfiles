# Post-migration subagent measurements

Measured on 2026-10-23 against the [pre-migration baseline](baseline.md). Raw samples, native receipts, usage records, manifests, and fingerprints are in [candidate.json](candidate.json).

## Results

All eight runs passed their exact output and tool-count checks, including both warm-ups. Each workload has three measured fresh-child samples.

| Workload | Baseline completion median | Candidate completion median | Observed delta | Candidate range |
| --- | ---: | ---: | ---: | ---: |
| Minimal reply | 7.790 s | 3.179 s | -4.611 s, -59.2% | 2.495–4.676 s |
| Fixed package read | 8.972 s | 3.934 s | -5.038 s, -56.2% | 3.865–4.086 s |

| Workload | Baseline acknowledgement median | Candidate acknowledgement median | Candidate range |
| --- | ---: | ---: | ---: |
| Minimal reply | 134 ms | 124 ms | 119–130 ms |
| Fixed package read | 125 ms | 121 ms | 119–136 ms |

These observations do not establish a causal speedup. They compare historical and current cohorts with uncontrolled provider and cache state, changed tool/context loading, and only three measured samples per workload. No practical improvement threshold was set, matching the baseline's descriptive scope. There is no significance, p95, throughput, or isolated runner-overhead estimate.

## Source footprint

| Scope | Baseline files / bytes / lines | Candidate files / bytes / lines |
| --- | ---: | ---: |
| Runner production TypeScript | 74 / 494,486 / 12,682 | 22 / 147,964 / 2,978 |
| Original local integration/configuration manifest | 8 / 66,396 / 1,928 | 8 / 65,726 / 1,906 |
| Runner tests and fixtures | 0 / 0 / 0 | 23 / 126,757 / 2,324 |
| Original local test manifest | 5 / 77,927 / 2,276 | 5 / 77,771 / 2,257 |
| Specialist definitions | 20 / 61,186 / 1,014 | 20 / 61,971 / 960 |
| Orchestration instructions | 5 / 19,599 / 105 | 5 / 20,737 / 115 |

The replacement production source is 70.1% smaller in logical bytes. Production plus the original local integration manifest totals 213,690 bytes versus 560,882, a 61.9% reduction in that scope. All original integration paths remain counted, including inactive leftovers. Shared prompt UI, mentions, provider integration, and other shared dependencies remain outside both inventories. This is not a full dependency closure or a measurement of installed disk savings: the disabled old package remains on disk.

The lexical proxy falls from 1,721 to 930 markers in runner production source, and from 413 to 408 in local integration. It uses the baseline regular expression, including comments and strings. It is not semantic complexity or evidence that behavior and safeguards are equivalent.

Specialist and orchestration text grows from 80,785 to 82,708 bytes, up 2.4%. Its combined line count is 1,075 and whitespace word count is 11,048. These inventories are not injected prompt tokens. Candidate per-response usage is recorded, but the baseline lacks comparable exact usage, so token savings remain unmeasured. Zero shipped baseline tests does not mean upstream lacked tests.

## Protocol and provenance

- Candidate HEAD is `7b54b734726759e3729aa8db19805a0e3be76cac`, with migration and unrelated worktree changes. The raw artifact fingerprints the scoped files.
- Host remains Darwin 27.0.0, arm64; Pi 1.3.0, Node v24.20.0, Bun 1.4.2, Python 3.14.8.
- Exact baseline prompts and original package fixture path were reused. The fixture SHA-256 matches the baseline. Model-presets and root/global AGENTS files also match their recorded fingerprints.
- Native transcript messages identify `openai-codex/gpt-6-luna-fast` with `low` thinking for every response. The specialist remains `quick`; its migrated definition and capability loading differ intentionally.
- Each launch used `foreground: false`, `inheritContext: false`, and `maxTurns: 4`. The immediate native wait used a 120,000 ms timeout. No parent reasoning turn occurred between a measured launch and wait.
- One fresh-child warm-up preceded three measured serial children per workload. The parent was already warm; caches were not reset and earlier idle sessions remained. No other benchmark worker ran during sampling. The visualization worker launched only after all samples completed.
- Timing uses parent codemode `Date.now()` around launch and immediate wait. Acknowledgement is not child-ready latency. Completion includes provider/network time, inference, tool work, and report delivery.
- The native completion receipts reported storage `not-attempted`; later native status checks confirmed `saved` for all eight workers. These timings therefore do not measure durable-storage completion.
- Inspection samples made exactly one `read` call to the fixed fixture. Minimal samples made no tool calls. No runtime failures, retries, discarded outliers, or extended sampling occurred.

## Collection and limits

Static collection follows the explicit manifests in the raw artifact. Logical bytes come from Python `os.stat`; SHA-256 comes from `shasum -a 256`. Hashline reads page through `nextOffset` to EOF for line, whitespace-word, and lexical-marker counts. Each reconstructed UTF-8 size was checked against the file size, allowing only the final newline omitted by the read tool.

Collection setup errors did not affect measured samples. The first baseline JSON read was truncated; native transcripts required TOON rather than JSON decoding; the initial static collector stopped at page limits. All were corrected before accepting the corresponding results. GNU `stat` rejected BSD flags with exit 1 and was replaced by Python metadata collection. Details remain in `candidate.json`.

No implementation or dependency changes were made. CPU, memory, allocations, cold startup, inherited context, queue saturation, and representative coding/review workloads remain unmeasured. The prior terminal UX, lifecycle acceptance, rollback, and broad validation gaps are not resolved by these benchmarks.

For a causal performance claim, predeclare a practical threshold and collect enough interleaved old/new samples in an isolated fixture with controlled model, prompts, tools, context, and cache policy. Do not re-enable both runners in the production parent.
