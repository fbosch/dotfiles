# Context Images Performance Baseline

Recorded on 2026-07-13 with:

- Linux 7.1.3-cachyos
- Intel Core i7-8700K at 3.70 GHz
- Bun 1.3.13
- pxpipe 0.2.0
- 9,180 bytes of instructions and one 32 KiB cached PNG

Run the benchmark from this directory with `bun run bench`.

## Method

The in-process cases use 10 warmup iterations and 50 measured iterations. The pxpipe render cases use one warmup and 10 measured iterations. Results below are the ranges from two consecutive runs on an otherwise interactive workstation.

The cache-miss case stubs rendering. It measures plugin overhead through render dispatch, not pxpipe. The pxpipe cases measure cold executable identity detection and the full library and CLI render paths, including cache publication and artifact reload.

The package script removes Bun's `npm_package_version` environment variable so the displayed pxpipe version is accurate.

## Baseline

| Case | Mean range | Median range | p95 range |
| --- | ---: | ---: | ---: |
| Load rendered context | 0.115-0.150 ms | 0.074-0.088 ms | 0.135-0.225 ms |
| Message transform, cache hit | 0.251-0.392 ms | 0.230-0.242 ms | 0.327-1.053 ms |
| Message transform, cache miss | 0.164-0.190 ms | 0.142-0.152 ms | 0.230-0.241 ms |
| System replacement | 0.042-0.046 ms | 0.040-0.042 ms | 0.063-0.077 ms |
| Cold pxpipe identity | 0.400-0.622 ms | 0.340-0.459 ms | 0.678-1.430 ms |
| Pxpipe library render | 21.538-22.865 ms | 21.287-21.917 ms | 26.214-28.570 ms |
| Pxpipe CLI render | 429.061-429.798 ms | 402.927-429.243 ms | 466.808-619.340 ms |

The recurring cached path is sub-millisecond. Persistent in-process rendering averages about 22 ms, while the CLI fallback averages about 429 ms. The library path is roughly 19 times faster and removes about 95% of render latency. Compare future results on the same host and inspect multiple runs before treating sub-millisecond differences as regressions.

## Change From Initial Baseline

Replacing `pxpipe --version` with a SHA-256 identity of the resolved executable reduced cold cache-version lookup from 345.440-348.465 ms to 0.360-0.393 ms, about 99.9%. This removes roughly 347 ms from a first-process cache hit and from a first-process cache miss. Real rendering stayed near 400 ms.

Loading pxpipe's `runExportCore` into the plugin process reduced a warm render from 429.061-429.798 ms through the CLI to 21.538-22.865 ms through the library. The plugin falls back to `pxpipe export` when package discovery, import, or library rendering fails.
