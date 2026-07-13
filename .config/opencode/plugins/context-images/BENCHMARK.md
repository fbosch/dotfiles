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
| Load rendered context | 0.098-0.113 ms | 0.070-0.078 ms | 0.134-0.303 ms |
| Message transform, cache hit | 0.225-0.308 ms | 0.190-0.202 ms | 0.305-0.691 ms |
| Message transform, cache miss | 0.161-0.175 ms | 0.115-0.139 ms | 0.207-0.288 ms |
| System replacement | 0.041-0.043 ms | 0.039-0.041 ms | 0.062-0.068 ms |
| Cold pxpipe identity | 0.271-0.298 ms | 0.231-0.290 ms | 0.385-0.403 ms |
| Library first use, immediate | 594.579-597.199 ms | 590.469-593.541 ms | 620.623-630.929 ms |
| Library first use, after 100 ms | 96.782-100.265 ms | 47.737-48.761 ms | 544.017-567.131 ms |
| Library first use, after 500 ms | 40.193-41.487 ms | 38.655-42.019 ms | 49.038-52.281 ms |
| Warm pxpipe library render | 16.474-17.320 ms | 15.395-17.910 ms | 19.748-22.482 ms |
| Pxpipe CLI render | 351.518-387.236 ms | 341.509-385.022 ms | 397.619-405.984 ms |

The recurring cached path is sub-millisecond. Warm in-process rendering averages 16-17 ms, roughly 21-23 times faster than the CLI fallback. Library import is expensive: an immediate first use costs about 596 ms. Background preload needs more than 100 ms to complete reliably; after 500 ms idle, first-request rendering averages 40-41 ms. Compare future results on the same host and inspect multiple runs before treating sub-millisecond differences as regressions.

## Change From Initial Baseline

Replacing `pxpipe --version` with a SHA-256 identity of the resolved executable reduced cold cache-version lookup from 345.440-348.465 ms to 0.360-0.393 ms, about 99.9%. This removes roughly 347 ms from a first-process cache hit and from a first-process cache miss. Real rendering stayed near 400 ms.

Loading pxpipe's `runExportCore` into the plugin process reduced a warm render from 429.061-429.798 ms through the CLI to 21.538-22.865 ms through the library. The plugin falls back to `pxpipe export` when package discovery, import, or library rendering fails.

Starting package import and a tiny renderer warmup during plugin initialization reduced first-render latency after a 500 ms idle period from 608-615 ms to 40-41 ms. A 100 ms idle period was insufficient in one of ten samples per run.

Returning validated in-memory artifacts after successful cache publication, instead of reading them before and after rename, reduced warm library rendering from 20.760 ms immediately before the change to 16.474-17.320 ms afterward.
