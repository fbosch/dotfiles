# Context Images Performance Baseline

Recorded on 2026-07-14 with:

- Linux 7.1.3-cachyos
- Intel Core i7-8700K at 3.70 GHz
- Bun 1.3.13
- pxpipe 0.7.1 (`sha256:b7eedd655e27` executable identity)
- 9,180 bytes of instructions and one 32 KiB cached PNG

Run the benchmark from this directory with `bun run bench`.

## Method

The in-process cases use 10 warmup iterations and 50 measured iterations. The warm pxpipe render cases use one warmup and 10 measured iterations. Cold library cases use 10 fresh Bun processes and report timing from inside each worker, excluding process launch. Results below are the ranges from two consecutive runs on an otherwise interactive workstation.

The cache-miss case stubs rendering. It measures plugin overhead through render dispatch, not pxpipe. The pxpipe-miss cases use a preloaded renderer with a fresh cache per iteration: dispatch stops when the plaintext request can continue, while cache-ready timing includes background rendering, publication, and validation. Each iteration verifies that a second transform uses the published image. Other pxpipe cases measure cold executable identity detection and the full library and CLI render paths.

The benchmark reports pxpipe's portable SHA-256 executable identity because pxpipe 0.7.1 has a stale `0.2.0` command fallback.

## Historical Context Savings

The following single-package measurement predates per-file image locality and is retained only as a historical baseline:

| Representation | Tokens |
| --- | ---: |
| OpenCode-wrapped plaintext (`o200k_base`) | 2,849 |
| Inline prompt and exact-string index (`o200k_base`) | 236 |
| System authority marker (`o200k_base`) | 49 |
| PNG input (provider-accounted) | approximately 851 |
| **Complete image replacement** | **approximately 1,136** |

That representation saved approximately 1,713 input-context tokens per qualifying model call, or 60.1% of the instruction block. It is not the current representation. The per-file package requires a new provider-accounted measurement covering every prompt and image before current savings can be stated.

This historical snapshot used 14,360 source characters and one unchanged 1568×384 PNG (`sha256:6693cd806edd`). The PNG figure came from the controlled provider usage measurement for that byte-identical page; pxpipe's manifest estimate was lower and was not used in the total. These numbers measured context usage, not billing, and did not establish semantic parity.

## Baseline

| Case | Mean range | Median range | p95 range |
| --- | ---: | ---: | ---: |
| Load rendered context | 0.061-0.069 ms | 0.062-0.065 ms | 0.074-0.104 ms |
| Message transform, cache hit | 0.319-0.450 ms | 0.304-0.358 ms | 0.437-0.852 ms |
| Startup warm, cache hit | 0.384-0.525 ms | 0.341-0.416 ms | 0.513-0.971 ms |
| Message transform, cache miss | 0.290-0.334 ms | 0.234-0.262 ms | 0.437-0.527 ms |
| System replacement | 0.038-0.040 ms | 0.033-0.035 ms | 0.054-0.058 ms |
| Cold pxpipe identity | 0.245-0.411 ms | 0.225-0.272 ms | 0.362-1.409 ms |
| Library first use, immediate | 427.323-468.667 ms | 417.870-461.812 ms | 476.245-523.044 ms |
| Library first use, after 100 ms | 35.723-38.539 ms | 34.668-37.719 ms | 41.901-47.087 ms |
| Library first use, after 500 ms | 28.923-32.165 ms | 27.910-29.032 ms | 35.820-50.524 ms |
| Startup warm, preloaded cache miss | 16.457-16.966 ms | 15.693-16.023 ms | 20.552-23.878 ms |
| Pxpipe cache-miss dispatch | 0.278-0.672 ms | 0.273-0.332 ms | 0.377-1.864 ms |
| Pxpipe cache ready | 23.664-30.416 ms | 22.528-29.647 ms | 28.128-41.131 ms |
| Warm pxpipe library render | 12.257-14.206 ms | 11.994-13.853 ms | 13.381-16.705 ms |
| Pxpipe CLI render | 296.274-320.345 ms | 295.972-311.212 ms | 306.937-358.184 ms |

The recurring cached path remains sub-millisecond. Requiring and reading token metadata raised message-transform and startup cache-hit means while preserving the same latency class. Library first use averaged 427-469 ms in these runs; after background preload, first rendering averaged 29-39 ms. The second run contained scheduler outliers in startup and miss-ready cases, so those rows retain the prior representative ranges. Compare future results on the same host and inspect multiple runs before treating sub-millisecond differences as regressions.

Prompt and factsheet compaction did not materially regress the recurring path. Cache-hit transformation is no slower than the previous range. System replacement increased by about 0.01 ms while remaining below 0.05 ms. Since pxpipe changed from 0.2.0 to 0.7.1 between recorded baselines, renderer improvements cannot be attributed solely to plugin changes.

## Background Cache Warming

Immediately before this change, a warm in-process pxpipe render averaged 19.812 ms and was awaited by the cache-miss request. Background warming reduces request-path dispatch to 0.278-0.672 ms, at least 96.6% less preparation latency. The cache becomes usable after 23.664-30.416 ms, outside the measured request path.

The first call for a new source-content, renderer, and model cache key retains plaintext. Each instruction file has an independent cache entry, and replacement waits until every source package is ready. Later calls use the images after all publications succeed. Identical misses share one task. Two distinct renders may run concurrently and at most 16 may be active or queued; excess keys remain plaintext and retry later. Rendering is deferred to a later event-loop turn but remains in the OpenCode process rather than a worker thread.

The plugin warms ambient instructions for the configured default model during startup. A cache hit adds 0.133-0.146 ms. A preloaded cache miss adds 16.457-16.966 ms. Startup waiting is capped at one second; if rendering is still incomplete, OpenCode continues and the render remains active in the background.

## Change From Initial Baseline

Replacing `pxpipe --version` with a SHA-256 identity of the resolved executable reduced cold cache-version lookup from 345.440-348.465 ms to 0.360-0.393 ms, about 99.9%. This removes roughly 347 ms from a first-process cache hit and from a first-process cache miss. Real rendering stayed near 400 ms.

Loading pxpipe's `runExportCore` into the plugin process reduced a warm render from 429.061-429.798 ms through the CLI to 21.538-22.865 ms through the library. The plugin falls back to `pxpipe export` when package discovery, import, or library rendering fails.

Starting package import and a tiny renderer warmup during plugin initialization reduced first-render latency after a 500 ms idle period from 608-615 ms to 40-41 ms. A 100 ms idle period was insufficient in one of ten samples per run.

Returning validated in-memory artifacts after successful cache publication, instead of reading them before and after rename, reduced warm library rendering from 20.760 ms immediately before the change to 16.474-17.320 ms afterward.
