# Subagent benchmark rerun

Measured on 2026-10-23 at HEAD `3f30a4bc6c89e34dbc1455104dbc41d6e68a0ad9` against the [pre-migration baseline](baseline.md). [Raw samples and receipts](candidate-rerun-2026-10-23.json) retain exact prompts, timestamps, tool-call checks, response usage, and configuration fingerprints.

All eight runs passed, including one warm-up per workload. Each workload has three measured serial fresh-child runs. There were no workload failures, retries, discarded samples, or timeouts.

| Workload | Baseline completion median | Current median | Current range | Observed median change |
| --- | ---: | ---: | ---: | ---: |
| Minimal reply | 7.790 s | 4.691 s | 4.222–5.059 s | -3.099 s, -39.8% |
| Fixed package read | 8.972 s | 5.522 s | 5.293–6.063 s | -3.450 s, -38.5% |

| Workload | Baseline acknowledgement median | Current median | Current range |
| --- | ---: | ---: | ---: |
| Minimal reply | 134 ms | 226 ms | 191–247 ms |
| Fixed package read | 125 ms | 191 ms | 180–205 ms |

Completion medians are lower than the original baseline, while acknowledgement medians are higher by 92 ms and 66 ms. The [earlier candidate run](candidate.md) recorded completion medians of 3.179 s and 3.934 s, lower than this rerun. These historical observations do not establish a causal improvement or regression. Provider/cache state is uncontrolled, the runner and context differ intentionally from baseline, and three samples cannot establish stable latency distributions. No practical effect threshold was set, matching the baseline's descriptive scope.

## Protocol and checks

- The worktree was clean before these result artifacts. Host and runtimes match the recorded cohort: Darwin 27.0.0 arm64, Pi 1.3.0, Node v24.20.0, Bun 1.4.2.
- The original fixture remains at `.pi/agent/npm/node_modules/@gotgenes/pi-subagents/package.json`. Its SHA-256 and the model-presets, root AGENTS, and global AGENTS fingerprints match baseline. The old runner was not re-enabled.
- Each native launch used `quick`, `maxTurns: 4`, `inheritContext: false`, and `foreground: false`, with no model override. Every observed response identifies `openai-codex/gpt-6-luna-fast` and `low` thinking.
- One warm-up preceded three measured children for each exact prompt from `baseline.json`. The parent was already running; caches were not reset. Earlier idle child sessions remained. No analysis or visualization worker ran during sampling.
- Parent codemode used `Date.now()` around native launch and an immediate `subagent_result` wait with `timeoutMs: 120000`. No parent reasoning turn occurred between launch and wait. Acknowledgement is not child-ready latency.
- Minimal reports equal `PROBE_OK` and use zero tools. Inspection reports equal `name=@gotgenes/pi-subagents; version=25.0.1; node=>=22` and use exactly one successful fixture read. Both absolute and cwd-relative paths identify the same fixture.
- All completion receipts preceded persistence confirmation. Later native status checks report `saved` for all eight workers. Completion timings do not measure durable-storage completion.
- Benchmark protocol inspection exhausted its worker budget without measurements. Parent source verification resolved the missing-script concern: the established protocol uses native tools, not a standalone script. Collector setup errors and the corrected absolute-path check are recorded in the raw artifact.

Token savings remain unmeasured because baseline usage is not comparable. This rerun did not collect source footprint, CPU, memory, allocations, cold-start latency, throughput, queue saturation, or representative coding/review workloads.
