# Context Images Performance Baseline

Recorded on 2026-07-13 with:

- Linux 7.1.3-cachyos
- Intel Core i7-8700K at 3.70 GHz
- Bun 1.3.13
- pxpipe 0.2.0
- 9,180 bytes of instructions and one 32 KiB cached PNG

Run the benchmark from this directory with `bun run bench`.

## Method

The in-process cases use 10 warmup iterations and 50 measured iterations. The warm pxpipe render cases use one warmup and 10 measured iterations. Cold library cases use 10 fresh Bun processes and report timing from inside each worker, excluding process launch. Results below are the ranges from two consecutive runs on an otherwise interactive workstation.

The cache-miss case stubs rendering. It measures plugin overhead through render dispatch, not pxpipe. The pxpipe cases measure cold executable identity detection and the full library and CLI render paths, including cache publication and artifact reload.

The package script removes Bun's `npm_package_version` environment variable so the displayed pxpipe version is accurate.

## Baseline

| Case | Mean range | Median range | p95 range |
| --- | ---: | ---: | ---: |
| Load rendered context | 0.163-0.185 ms | 0.066-0.088 ms | 0.364-0.832 ms |
| Message transform, cache hit | 0.305-0.384 ms | 0.220-0.247 ms | 0.722-0.759 ms |
| Message transform, cache miss | 0.154-0.244 ms | 0.114-0.146 ms | 0.229-0.928 ms |
| System replacement | 0.032-0.038 ms | 0.028-0.036 ms | 0.059-0.065 ms |
| Cold pxpipe identity | 0.288-0.327 ms | 0.290-0.318 ms | 0.371-0.450 ms |
| Library first use, immediate | 610.900-632.611 ms | 608.437-623.357 ms | 635.485-672.805 ms |
| Library first use, after 100 ms | 43.798-44.797 ms | 42.081-42.515 ms | 48.807-52.611 ms |
| Library first use, after 500 ms | 43.983-46.118 ms | 43.378-44.392 ms | 52.068-52.845 ms |
| Warm pxpipe library render | 19.517-20.090 ms | 17.655-18.583 ms | 26.738-29.098 ms |
| Pxpipe CLI render | 397.169-420.940 ms | 394.409-421.034 ms | 422.718-461.036 ms |

The recurring cached path is sub-millisecond. Warm in-process rendering averages 19-20 ms, roughly 20 times faster than the CLI fallback. Library import is expensive: an immediate first use costs 611-633 ms. After background preload, first-request rendering averages 44-46 ms. Compare future results on the same host and inspect multiple runs before treating sub-millisecond differences as regressions.

## Change From Initial Baseline

Replacing `pxpipe --version` with a SHA-256 identity of the resolved executable reduced cold cache-version lookup from 345.440-348.465 ms to 0.360-0.393 ms, about 99.9%. This removes roughly 347 ms from a first-process cache hit and from a first-process cache miss. Real rendering stayed near 400 ms.

Loading pxpipe's `runExportCore` into the plugin process reduced a warm render from 429.061-429.798 ms through the CLI to 21.538-22.865 ms through the library. The plugin falls back to `pxpipe export` when package discovery, import, or library rendering fails.

Starting package import and a tiny renderer warmup during plugin initialization reduced first-render latency after a 500 ms idle period from 608-615 ms to 40-41 ms. A 100 ms idle period was insufficient in one of ten samples per run.

Returning validated in-memory artifacts after successful cache publication, instead of reading them before and after rename, reduced warm library rendering from 20.760 ms immediately before the change to 16.474-17.320 ms afterward.
