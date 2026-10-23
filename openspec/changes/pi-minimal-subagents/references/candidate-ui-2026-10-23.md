# Subagent benchmark after worker-card updates

Measured on 2026-10-23 at HEAD `f736cc3a505bf83bb1f20ee2182cca332956dc01`. All eight runs passed exact-output, tool-use, and resolved-model checks. Each workload had one warmup followed by three measured fresh children.

| Workload           | Previous median | Current median |    Current range | Change from previous |
| ------------------ | --------------: | -------------: | ---------------: | -------------------: |
| Minimal reply      |         4.691 s |        4.938 s | 4.008 to 5.168 s |       +247 ms, +5.3% |
| Fixed package read |         5.522 s |        4.802 s | 3.646 to 4.962 s |      -720 ms, -13.0% |
|                    |                 |                |                  |                      |

Acknowledgement medians were **128 ms** for minimal reply and **112 ms** for fixed read, compared with 226 ms and 191 ms in the previous rerun. Current acknowledgement ranges were 127 to 230 ms and 111 to 118 ms.

Against the original pre-migration baseline, completion medians changed from 7.790 s to 4.938 s and from 8.972 s to 4.802 s. Those differences are -2.852 s, -36.6%, and -4.170 s, -46.5%, respectively.

These are historical observations, not evidence that the UI changes caused an improvement or regression. Provider/cache state is uncontrolled, and three samples per workload do not establish stable latency distributions. No practical effect threshold was set, matching the earlier descriptive runs. The causal verdict remains **inconclusive**.

## Protocol and evidence

- Same exact prompts, original package fixture, `quick` specialist, `presets/routine`, four-turn budget, no inherited context, and background launch as the [previous rerun](candidate-rerun-2026-10-23.md).
- Every assistant response identified `openai-codex/gpt-6-luna-fast` with `low` thinking. Minimal replies used zero tools; fixed reads used exactly one successful fixture read.
- Warm existing parent, no cache reset, serial fresh children, and no active analysis or visualization workers during sampling. Earlier historical workers and one idle smoke-test child remained.
- Parent codemode measured `Date.now()` before launch, on acknowledgement, and after an immediate native completion wait. Transcript and persistence checks ran outside that interval. Acknowledgement is not child-ready latency, and completion is not durable-storage latency.
- All eight workers later reported `saved`. No workload failed, timed out, or was retried or discarded.
- Darwin 27.0.0 arm64, Pi 1.3.0, Node v24.20.0, Bun 1.4.2. The worktree was clean immediately before and after sampling; source/configuration fingerprints were unchanged. HEAD advanced during preparation outside this agent's actions, before any workload ran.
- The first warmup's transcript exceeded codemode's state limit. Its emitted timings and IDs survived; native inspection recovered response evidence. Its start timestamp and launch receipt are unavailable. Two collector-recovery errors were fixed before measured runs. The [raw artifact](candidate-ui-2026-10-23.json) records those gaps, all samples, exact prompts, native receipts, response usage, fingerprints, and calculations.

Token savings remain unmeasured because the original baseline lacks comparable usage. This run did not measure CPU, memory, cold starts, throughput, UI frame cost, or representative coding/review work. A causal comparison needs paired runs of both revisions under controlled conditions.
