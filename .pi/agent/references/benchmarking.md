# Benchmarking workflow

Use this for runtime performance comparisons. Agent routing and skill quality require evaluation against labeled tasks, not elapsed-time benchmarks. For hot-path attribution, load the [`hot-path-analysis` skill](../../../.agents/skills/hot-path-analysis/SKILL.md); a profile locates costs but does not replace an unprofiled performance comparison. For skill evaluations, use the separate [`scripts/caliper-skill-eval.sh`](../../../scripts/caliper-skill-eval.sh) workflow rather than invoking Caliper directly.

## Choose the workload

Use the target, workload, symptom, authorization, and implementation context supplied by the parent task. If the target or workload is missing, report what is needed rather than inventing it.

1. Name the metric, target, input or fixture, load or concurrency, and the user-visible operation it represents. Check the output for correctness before timing both baseline and candidate. If no runnable representative workload exists, say so; a microbenchmark answers a narrower question.
2. Identify baseline and candidate by revision plus relevant worktree changes, build, runtime version and flags. Hold host, OS, architecture, build mode, dependencies, configuration, input, and measurement environment fixed except for intentional changes, which must be named. Keep macOS and Linux in separate cohorts. Do not infer a causal effect from runs with uncontrolled differences.
3. Define preparation and warmup before sampling: what is reset, what remains cached, and whether cold or warm behavior is the objective. Apply the same policy to both sides. Use unprofiled runs for the comparison; collect profiles separately if attribution is needed. Never compare profiled timing with unprofiled timing.
4. Set a bounded run budget and stopping rule in advance. Capture repeated samples for each side; use paired or interleaved runs when the runner supports them to reduce drift. Stop early for invalid output, changed fixtures, or environmental instability. Do not extend sampling until a desired verdict appears.

## Repository entry points

- `just bun-benchmark` defaults to `runtime`; `just bun-benchmark install`, `just bun-benchmark profiles`, and `just bun-benchmark all` select other targets. `all` runs runtime and install benchmarks; profiles remain opt-in. Inspect [`scripts/benchmark-bun.sh`](../../../scripts/benchmark-bun.sh) for prerequisites, sample settings, and outputs. Its `worktree.patch` captures `git diff --binary HEAD -- .`, potentially including unrelated tracked changes. Review and redact or withhold artifacts before sharing; never put secrets in metadata or artifacts.
- `just pi-benchmark` defaults to `breakdown`; `just pi-benchmark full` records the primary workload only. Follow [Pi startup benchmark](../benchmarks/README.md) for fixture, warm-cache policy, controls, metadata, and raw Hyperfine output. This measures credential-free warm-cache startup, not cold boot or agent quality. Check its provenance and setup fingerprint before comparing runs.
- Other targets need their own representative workload and recorded policy. Do not install missing tools or dependencies without permission. If a runner or necessary permission is unavailable, name the missing prerequisite and a non-mutating alternative if one exists.

## Compare and report

Record the exact command, output/artifact locations, sanitized baseline and candidate identities, environment and preparation policy, metric units, run count, and raw samples or links to them. Report each distribution (for example median, range and spread), absolute and percent delta with the direction of improvement, and the uncertainty or limitations supported by the sampling design. Hyperfine spread is variability, not a confidence interval. Calculate statistics and thresholds deterministically; do not invent significance or causality.

Choose a practical effect threshold for the metric and workload before sampling, including absolute impact where relevant. Do not reuse another benchmark's sample count, percentage, or statistical method as a universal rule. Call an improvement or regression only when correctness holds, comparisons are valid, and the observed effect exceeds the chosen practical threshold with uncertainty small enough to support its direction. Otherwise report `inconclusive`, the specific missing side, noise or confounder, and the smallest decisive next check. Report CPU time, memory, or allocations only when collected and relevant; do not infer them from wall time.
