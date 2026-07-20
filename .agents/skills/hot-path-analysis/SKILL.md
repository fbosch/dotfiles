---
name: hot-path-analysis
description: Identify and validate runtime hot paths with profiling evidence. Use when locating a hotspot or bottleneck, profiling CPU, latency, allocations, GC, I/O, or contention, or deciding what code to optimize.
---

# Hot-Path Analysis

Identify paths that materially affect a declared metric under a representative workload. Code inspection finds **static suspects**; only dynamic measurements establish a hot path.

## Pre-flight

Collect or request:

- Target: executable, test, endpoint, process, or benchmark.
- Objective: throughput, latency, CPU, allocation rate, GC pause, memory, I/O wait, or contention.
- Representative workload: inputs, concurrency, duration, warm/cold intent, and required services or fixtures.
- Environment: platform, build mode, runtime version and flags.
- Authorization and data boundary: local, staging, container, or production; permitted artifacts and storage.

Do not attach to a live process, enable diagnostic endpoints, elevate privileges, add container capabilities, install tools, or profile production without explicit authorization. Treat profiles, traces, heap dumps, command lines, URLs, environment variables, and symbols as sensitive artifacts.

If no runnable representative workload exists, stop before claiming a hot path. Report static suspects and the smallest missing prerequisite. Do not replace the workload with a microbenchmark unless the user accepts its narrower scope.

## Workflow

1. State the metric and workload. Use wall time for end-to-end latency; CPU profiles do not include sleeping or I/O wait.
2. Inspect the code and label loops, repeated allocation/copying, serialization, locks, blocking calls, and expensive algorithms as **static suspects** only.
3. Capture an unprofiled baseline across multiple comparable runs. Warm JITs, caches, pools, and lazy initialization unless cold-start behavior is the objective.
4. Select the signal by symptom:
   - CPU saturated: sampled CPU profile and call tree.
   - High latency with low CPU: wall-time or trace evidence for I/O, queues, and off-CPU waits.
   - High allocation or GC: allocation profile plus GC events.
   - Poor scaling or idle workers: mutex, block, and scheduler evidence.
5. Capture self and inclusive costs with call-tree attribution. Repeat enough to establish whether rankings are stable. Record profiler overhead, lost samples, and missing native frames.
6. Make one narrow causal hypothesis. Validate it with comparable end-to-end runs, then re-profile: optimizing a path can move the bottleneck.

## Tool Selection

Prefer repository-native tooling and do not install missing tools without approval.

| Runtime | Start with | Use for |
| --- | --- | --- |
| C/C++ on Linux | `perf stat`, `perf record -g` | CPU samples and hardware counters |
| Rust | `perf` or `cargo flamegraph`; `samply` where appropriate | Native CPU call stacks |
| Go | `pprof`; `go tool trace` | CPU, heap, allocations, block, mutex, scheduler |
| JVM | JDK Flight Recorder and Mission Control; JMH for microbenchmarks | CPU, allocation, GC, locks, I/O |
| .NET | `dotnet-counters`, `dotnet-trace`, `dotnet-gcdump` | Runtime events, CPU, GC, thread pool |
| Node.js/TypeScript | `--cpu-prof`, `--heap-prof`, trace events | V8 CPU, allocations, async runtime activity |
| Python | `py-spy`, `cProfile`, `tracemalloc` | Sampling, call counts, Python allocations |
| Ruby | `rbspy` or StackProf | Ruby CPU call stacks |
| PHP | Xdebug profiler in controlled development or staging | Function timing and calls |

Sampling is the default for broad, low-overhead CPU attribution. Instrumentation gives exact call counts but can distort frequent calls. Tracing explains elapsed time across I/O and queues but not necessarily CPU consumption. Benchmarks quantify a result; profiles localize resource use.

If the preferred profiler is unavailable or unsupported, do not install it or modify the target without approval. Use an existing repository benchmark, test harness, or runtime diagnostic already available. If no dynamic measurement is possible, return `inconclusive` with the required tool, permission, or environment as the next step.

## Evidence Labels

- **Static suspect:** inspection only. Never call it hot.
- **Provisional hotspot:** one valid profile with a named metric and attributable stack.
- **Confirmed hot path:** representative workload and at least two comparable captures with stable attribution.
- **Validated bottleneck:** a controlled change produces a stable end-to-end effect while preserving correctness and workload.
- **Inconclusive:** missing workload, noisy or contradictory captures, inadequate symbols, or missing resource signals.

Do not use a universal percentage threshold. Report exact measurements, sample counts, distributions, and uncertainty.

## Never

- Never attribute I/O, queueing, or lock delay to a CPU profile: it omits time while the process is not executing.
- Never compare profiled and unprofiled timings as a performance result: profiler overhead changes the measurement.
- Never optimize a parent's inclusive cost before inspecting its descendants' self cost: the parent may only be carrying their work.
- Never infer steady-state behavior from an un-warmed capture. Label startup and first-request evidence as cold-path results.

## Report

Return:

1. Verdict and confidence label.
2. Objective, workload, environment, warmup policy, and profiler configuration.
3. Repeated unprofiled baseline.
4. Ranked call paths with metric, self cost, inclusive cost, and caller-to-callee attribution.
5. Allocation/GC, I/O/blocking, and contention status: measured, absent, or not collected.
6. Artifact locations, sensitivity caveats, profiler limitations, and next decisive check.
