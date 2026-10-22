# Current subagent baseline

Measured on 2026-10-22 before replacing the runner. Raw samples, exact prompts, file manifests, SHA-256 fingerprints, and totals are in [baseline.json](baseline.json). This baseline covers footprint, a lexical complexity proxy, instruction inventory, and two live serial workloads. It does not establish a bottleneck or a replacement speedup.

## Provenance

- Repository HEAD: `1dd4327e0a0ca7c6984c2bdc0fb28c5d68584901`. The worktree was clean before this baseline's documentation edits.
- Installed runner: `@gotgenes/pi-subagents@25.0.1`. Installed Pi package metadata: `1.3.0`.
- Host: Darwin `27.0.0`, `arm64`. Available shell runtimes: Node `v24.20.0`, Bun `1.4.2`, Python `3.14.8`. These are not measurements of the running parent process's CPU or memory.
- Native probes used `quick`, whose configured model is `presets/routine`, resolving in the checked configuration to `openai-codex/gpt-6-luna-fast` with `low` thinking. Native result reports identify the preset, not the resolved provider model. Model/thinking overrides were omitted.
- Every probe used `max_turns: 4`, `inherit_context: false`, and `run_in_background: true`. The current configuration permits six concurrent workers; these probes ran serially.
- No dependencies, runtime source, model configuration, or credentials changed. Probe sessions produce normal runner history and may retain idle child sessions.

## Footprint

Bytes are logical file sizes, not allocated disk blocks, compressed download size, or retained memory. Lines include comments and blank lines.

| Scope | Files | Bytes | Lines |
| --- | ---: | ---: | ---: |
| Entire installed package, including docs and declarations | 117 | 1,364,147 | Not aggregated |
| Installed production TypeScript source | 74 | 494,486 | 12,682 |
| Tests shipped in the installed package | 0 | 0 | 0 |
| Scoped local integration and configuration | 8 | 66,396 | 1,928 |
| Corresponding local tests | 5 | 77,927 | 2,276 |
| Specialist Markdown definitions | 20 | 61,186 | 1,014 |
| Orchestration instructions | 5 | 19,599 | 105 |

Package source is a subset of the installed-package total; do not add those rows. Zero shipped tests does not mean upstream has no tests.

The local scope includes `routed-prompts.ts`, `subagent-steering-notice.ts`, the five `prompt-ui/subagent-*.ts` modules, and `subagents.json`. Tests cover those paths where matching test files exist. The initial worker inventory omitted the steering notice and its test; the final inventory adds them and independently reproduces the other totals.

Shared `prompt-ui` infrastructure, model/provider integration, hashline/codemode packages, instruction-fragment loading, agent mentions, handoff, and checkpoint helpers are outside these local totals. Those components are not all removable with the runner. Future comparisons must retain these boundaries or report expanded scopes separately.

## Code complexity

The installed source has **1,721 lexical markers**; local integration TypeScript has **413**. The configuration JSON contributes no markers.

The exact regular expression is recorded in `baseline.json`. It counts branch/loop keywords, boolean/nullish operators, and question marks other than optional chaining. It includes comments, strings, optional type annotations, and ternaries. It is a reproducible text proxy, not cyclomatic complexity, cognitive complexity, or a maintainability score. Moving comments or changing types can change it without changing control flow.

Use file/line footprint and this proxy to flag review targets, not to reward deleting safety checks. Semantic function complexity, import-graph coupling, and test coverage were not measured.

## Context size

The specialist-definition and orchestration inventory totals **80,785 bytes**, **1,119 lines**, and **11,131 whitespace-delimited words**. These are source-text volumes, not tokens and not the combined prompt of any child. Definitions include frontmatter; catalogs can expose descriptions without loading every prompt body. Orchestration references are loaded conditionally.

All eight live probes reported **5% context utilization**, rounded by the runner. Exact context tokens, serialized system-prompt bytes, tool-schema size, and input/cache/output usage breakdowns are unavailable through the result text collected here. Do not translate 5% into an exact token count or claim the whole 80,785-byte inventory is injected.

The native token labels vary from `158 token` to `12.8k token` for identical minimal prompts. The installed `src/lifecycle/usage.ts` defines the displayed lifetime total as `input + output + cacheWrite`, excluding `cacheRead`. `src/tools/get-result-report.ts` rounds context percentage. These labels therefore cannot measure full prompt size or cache-inclusive model traffic. Preserve the raw labels for provenance, but do not interpret a cache hit as a smaller context.

## Live performance

One fresh-child warm-up preceded each workload, followed by three serial fresh-child samples. The parent process was already running. Host and provider caches were not reset; this is neither cold startup nor a controlled cache-hit cohort. The benchmark-analysis worker had completed before probes began. Earlier idle sessions could still be retained.

| Workload | Correct samples | Launch-return median, range | Observed completion median, range |
| --- | ---: | --- | --- |
| Exact minimal reply, no tools | 3/3 | 134 ms, 10–140 ms | 7.790 s, 6.557–16.022 s |
| Fixed package metadata read | 3/3 | 125 ms, 113–130 ms | 8.972 s, 7.265–10.259 s |

Both warm-ups also passed. Minimal measured samples used zero tools; inspection samples used exactly one tool each. Exact prompts, timestamps, worker IDs, outputs, rounded native duration/token labels, and all eight samples are retained in `baseline.json`.

Timing starts immediately before `tools.subagent` in parent codemode. Launch-return ends when the background call returns its worker ID. It measures acknowledgement, not proof that child initialization or the first provider request has finished. Completion ends when the immediately issued native `get_subagent_result({wait:true, timeout:120})` returns. It includes scheduling, initialization, provider/network time, model inference, any tool work, and result delivery. Parent `Date.now()` provides millisecond wall-clock timestamps, not a monotonic timer. No parent reasoning turn occurs between launch and wait for measured samples.

The minimal warm-up used separate launch and wait codemode calls; its observed duration includes that gap and is excluded from summaries. The 120-second wait bound was not reached. Sampling stopped at the planned three measured runs per workload, with no retries or discarded outliers.

Three samples establish a replayable smoke baseline, not a stable tail-latency estimate. No p95, significance, throughput, isolated runner CPU cost, allocation rate, or memory claim is supported. A real coding/review workload and queue-saturation run remain separate future measurements.

## Replay and compare

1. Preserve `baseline.json`; write candidate results to a new artifact. Record candidate revision and relevant worktree changes. Keep the host, Pi/provider versions, specialist definition, model preset, thinking, limits, working directory, prompts, and cache policy fixed unless the difference is intentional and named.
2. Recalculate the static groups from the explicit manifests. For the replacement, declare equivalent production, local integration, tests, and instruction groups before measuring. Count dependencies and leftover integration code consistently; do not compare the entire old distribution against only the new entry point.
3. Run one warm-up and three serial samples for each exact prompt in `runtime.protocol`. Launch fresh `quick` workers with the recorded settings; await each result immediately. Stop on incorrect output, tool-count mismatch, timeout, or configuration drift. Do not silently swap models or extend sampling to obtain a preferred result.
4. Verify `PROBE_OK` for the minimal workload. For inspection, verify `name=@gotgenes/pi-subagents; version=25.0.1; node=>=22`. A snapshot is saved at `fixtures/pi-subagents-package.json`. Keep the original fixture path available after cutover, or use the snapshot and record the changed path as a workload revision before comparing. Do not silently substitute the replacement's package metadata.
5. Report raw samples, median, and range separately for acknowledgement and completion. These probes have no predeclared improvement threshold, so use them descriptively. Before a performance claim, agree a practical threshold and run enough comparable samples to separate the intended effect from provider/cache variability.
6. For exact context comparisons, instrument supported request/session APIs in a controlled fixture during the feasibility work. Record system text, tool schemas, input tokens including cache reads, and output separately without storing credentials or private conversation text. Do not infer these values from the current lifetime token label.

Static measurement can be replayed with Python's standard library over each manifest group. `Path.stat().st_size` supplies bytes, SHA-256 identifies content, `len(text.splitlines())` counts lines, `len(text.split())` counts words, and `len(re.findall(pattern, text))` supplies the lexical proxy for TypeScript only. Decode UTF-8, reject read errors, and exclude tests from production groups. The parent independently verified these totals through hashline reads before saving the artifact.

## Checks and limits

- The independent static collection matched the benchmark worker's shared scope exactly; the steering-notice addition is documented above.
- All six measured runtime outputs and both warm-ups passed their fixed output/tool-count checks. Native tools performed no writes requested by the workloads; normal session history is expected.
- `pi --version` exited 1 because the sandbox launcher rejected inherited GitHub-token environment variables. No credential changes or sandbox bypass followed. Pi version came from installed package metadata instead.
- No runtime source tests, cold-start benchmark, profiler, memory capture, or feasibility gate ran in this baseline slice. Parent-session teardown, selective capability loading, and native TUI feasibility remain unchecked.
