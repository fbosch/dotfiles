---
description: Profile a representative workload and identify measured hot paths
agent: benchmark
subtask: true
---

Load the `hot-path-analysis` skill and follow its workflow.

Target and workload: $ARGUMENTS

Pre-flight:
1. If the target or representative workload is absent, respond only: `Usage: /hotpaths <target and representative workload>`
2. Confirm profiling is authorized for the target environment. Do not attach to production or collect sensitive artifacts without explicit authorization.
3. Use repository-native tooling. Do not install packages or modify source files.

Identify static suspects separately from dynamic findings. Establish a repeated unprofiled baseline, select the profiler signal for the declared symptom, and report results using the skill's evidence labels. Mark the result `inconclusive` when dynamic evidence cannot be collected.
