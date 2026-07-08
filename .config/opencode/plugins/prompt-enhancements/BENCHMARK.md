# Typo Engine Benchmarks

Baseline benchmark for the OpenCode prompt typo engine.

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
