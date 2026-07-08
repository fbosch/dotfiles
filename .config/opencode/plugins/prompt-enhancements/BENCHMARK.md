# Typo Engine Benchmarks

Baseline benchmark for the OpenCode prompt typo engine.

Bun 1.3.13 does not expose a native `bench` API from `bun:test`, and `bun test --help` does not list a benchmark mode. The benchmark script uses a small local harness around `process.hrtime.bigint()` until Bun provides a native benchmark API in this environment.

Run from `.config/opencode/plugins`:

```bash
bun run bench:typos
```

The benchmark covers startup rule expansion and the per-space correction path for short and long prompts.

## Baseline

Environment:

- Date: 2026-07-08
- Runtime: Bun 1.3.13
- Rules: 357 expanded rules from `.config/fbb/data/typos.abolish`
- Source file size: 1531 bytes

Results:

| Case | Mean | Throughput | Iterations |
| --- | ---: | ---: | ---: |
| Parse shared typo rules | 257.423 us/op | 3,885 ops/s | 20,000 |
| Correct short no match | 0.078 us/op | 12,848,140 ops/s | 1,000,000 |
| Correct short match | 0.175 us/op | 5,723,120 ops/s | 1,000,000 |
| Correct long no match | 5.604 us/op | 178,456 ops/s | 500,000 |
| Correct long match | 0.087 us/op | 11,526,732 ops/s | 500,000 |

## Backward Scan Optimization

Changed `correctCompletedWord` from a full-input anchored regex to a backward suffix scan.

Results:

| Case | Mean | Throughput | Iterations | Change |
| --- | ---: | ---: | ---: | ---: |
| Parse shared typo rules | 296.616 us/op | 3,371 ops/s | 20,000 | 1.15x slower |
| Correct short no match | 0.108 us/op | 9,267,128 ops/s | 1,000,000 | 1.38x slower |
| Correct short match | 0.169 us/op | 5,921,643 ops/s | 1,000,000 | 1.04x faster |
| Correct long no match | 0.095 us/op | 10,488,531 ops/s | 500,000 | 58.99x faster |
| Correct long match | 0.179 us/op | 5,590,038 ops/s | 500,000 | 2.06x slower |

## Active Prompt Ref Optimization

Changed the space key handler from spreading a prompt-ref `Set` and finding the focused ref to reading one tracked active prompt ref directly.

Results:

| Case | Mean | Throughput | Iterations | Change |
| --- | ---: | ---: | ---: | ---: |
| Find ref via set spread | 0.028 us/op | 35,260,956 ops/s | 1,000,000 | baseline |
| Read active ref directly | 0.008 us/op | 119,338,222 ops/s | 1,000,000 | 3.50x faster |

Updated engine-path results from the same run:

| Case | Mean | Throughput | Iterations |
| --- | ---: | ---: | ---: |
| Parse shared typo rules | 269.753 us/op | 3,707 ops/s | 20,000 |
| Correct short no match | 0.146 us/op | 6,861,573 ops/s | 1,000,000 |
| Correct short match | 0.169 us/op | 5,900,108 ops/s | 1,000,000 |
| Correct long no match | 0.088 us/op | 11,308,515 ops/s | 500,000 |
| Correct long match | 0.162 us/op | 6,154,315 ops/s | 500,000 |

## Append Delimiter Optimization

Changed the runtime space handler to call `appendDelimiterAndCorrect(input, " ", ...)` instead of prebuilding `${input} ` and passing it to `correctCompletedWord`.

Results:

| Case | Previous Mean | Append Mean | Throughput | Iterations | Change |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short no match | 0.104 us/op | 0.092 us/op | 10,891,681 ops/s | 1,000,000 | 1.13x faster |
| Short match | 0.157 us/op | 0.144 us/op | 6,959,431 ops/s | 1,000,000 | 1.09x faster |
| Long no match | 0.093 us/op | 0.093 us/op | 10,695,455 ops/s | 500,000 | unchanged |
| Long match | 0.165 us/op | 0.150 us/op | 6,650,399 ops/s | 500,000 | 1.10x faster |

## Last-Character Guard Optimization

Added a `(word length, last char)` guard before slicing the completed word. This skips allocation and map lookup for no-match words whose final character cannot match any typo of that length.

Results:

| Case | Previous Append Mean | New Append Mean | Throughput | Iterations | Change |
| --- | ---: | ---: | ---: | ---: | ---: |
| Short no match | 0.092 us/op | 0.098 us/op | 10,212,137 ops/s | 1,000,000 | 6.5% slower |
| Short match | 0.144 us/op | 0.156 us/op | 6,420,204 ops/s | 1,000,000 | 8.3% slower |
| Long no match | 0.093 us/op | 0.053 us/op | 18,735,798 ops/s | 500,000 | 43.0% faster |
| Long match | 0.150 us/op | 0.163 us/op | 6,122,255 ops/s | 500,000 | 8.7% slower |

## Single Ending-Map Guard Optimization

Removed the separate typo-length `Set` and made the `(word length -> ending chars)` map the only pre-slice guard. Missing lengths now return before word slicing and map lookup.

Results:

| Case | Mean | Throughput | Iterations |
| --- | ---: | ---: | ---: |
| Correct short no match | 0.118 us/op | 8,504,197 ops/s | 1,000,000 |
| Correct no length match | 0.034 us/op | 29,791,986 ops/s | 1,000,000 |
| Correct short match | 0.180 us/op | 5,567,298 ops/s | 1,000,000 |
| Correct long no match | 0.051 us/op | 19,503,878 ops/s | 500,000 |
| Correct long match | 0.160 us/op | 6,260,487 ops/s | 500,000 |
| Append short no match | 0.106 us/op | 9,424,569 ops/s | 1,000,000 |
| Append no length match | 0.042 us/op | 23,840,914 ops/s | 1,000,000 |
| Append short match | 0.154 us/op | 6,474,000 ops/s | 1,000,000 |
| Append long no match | 0.054 us/op | 18,632,880 ops/s | 500,000 |
| Append long match | 0.147 us/op | 6,812,653 ops/s | 500,000 |

This improves words outside the typo length range substantially, but costs a little on short in-range words.
