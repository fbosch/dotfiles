# Context Images Performance Baseline

Recorded on 2026-07-13 with:

- Linux 7.1.3-cachyos
- Intel Core i7-8700K at 3.70 GHz
- Bun 1.3.13
- pxpipe 0.2.0
- 9,180 bytes of instructions and one 32 KiB cached PNG

Run the benchmark from this directory with `bun run bench`.

## Method

The in-process cases use 10 warmup iterations and 50 measured iterations. The real pxpipe render uses one warmup and 10 measured iterations. Results below are the ranges from two consecutive runs on an otherwise interactive workstation.

The cache-miss case stubs rendering. It measures plugin overhead through render dispatch, not pxpipe. The pxpipe cases measure cold version detection and the real export, cache publication, and artifact reload path separately.

The package script removes Bun's `npm_package_version` environment variable. Without that, `pxpipe --version` reports this package's version instead of the pxpipe version and produces an invalid cache key.

## Baseline

| Case | Mean range | Median range | p95 range |
| --- | ---: | ---: | ---: |
| Load rendered context | 0.085-0.102 ms | 0.066-0.068 ms | 0.180-0.220 ms |
| Message transform, cache hit | 0.238-0.270 ms | 0.185-0.201 ms | 0.470-0.567 ms |
| Message transform, cache miss | 0.184-0.191 ms | 0.131-0.135 ms | 0.218-0.244 ms |
| System replacement | 0.046-0.047 ms | 0.040-0.045 ms | 0.059-0.085 ms |
| Cold pxpipe version | 345.440-348.465 ms | 344.398-347.593 ms | 362.204-365.283 ms |
| Real pxpipe render | 387.391-397.522 ms | 392.356-394.865 ms | 413.046-418.571 ms |

The recurring cached path is sub-millisecond. A new plugin process adds about 347 ms for version detection, even on a cache hit. A first-process cache miss costs about 740 ms across version detection and rendering; subsequent renders cost about 390 ms. Compare future results on the same host and inspect multiple runs before treating sub-millisecond differences as regressions.
