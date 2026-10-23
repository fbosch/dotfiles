# UI status lookup benchmark

The lightweight status projection passed the focused synthetic rendering benchmark.

| Workload | Baseline | Candidate | Change | Result |
| --- | ---: | ---: | ---: | --- |
| Small | 0.3390 ms/frame | 0.2822 ms/frame | −0.0569 ms/frame | No regression; threshold was +0.1 ms/frame |
| History-heavy | 6.3689 ms/frame | 0.3213 ms/frame | −6.0477 ms/frame (−94.96%) | Pass; threshold was at least 0.5 ms/frame and 20% |

Both runs were stable within the harness budget, and candidate output-correctness checks passed. The two artifacts use the same harness hash and environment. The valid baseline is [ui-status-baseline-2026-10-23-rerun.json](ui-status-baseline-2026-10-23-rerun.json); the first baseline artifact is marked invalid because real widget timers remained active during sampling and its command timed out.

The candidate generator initially emitted a baseline-only verdict string for the candidate run. The artifact label and comparison were corrected, and the harness now emits phase-specific verdict text; no benchmark samples or timing data were changed.

The harness covers synthetic worker/card/widget rendering, not a full interactive terminal session or representative application workload. Treat the reduction as evidence for this targeted status path only; it does not establish general UI, CPU, memory, throughput, or user-perceived performance gains.
