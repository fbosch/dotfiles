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

## Context Savings

The active bundle contains the global and project `AGENTS.md` files plus the three local files in `config.instructions`. With the current source contents and compact prompt:

| Representation | Tokens |
| --- | ---: |
| OpenCode-wrapped plaintext (`o200k_base`) | 2,849 |
| Inline prompt and exact-string index (`o200k_base`) | 236 |
| System authority marker (`o200k_base`) | 49 |
| PNG input (provider-accounted) | approximately 851 |
| **Complete image replacement** | **approximately 1,136** |

The replacement saves approximately 1,713 input-context tokens per qualifying model call, or 60.1% of this instruction block. The prompt and marker use 285 text tokens. The additional authority language is intentional: it identifies the package as trusted configured context rather than user-pasted text.

This snapshot uses 14,360 source characters and one unchanged 1568×384 PNG (`sha256:6693cd806edd`). A fresh OpenCode process completed replacement without a mismatch. The PNG figure comes from the controlled provider usage measurement for that byte-identical page; pxpipe's manifest estimate is lower and is not used in the total. These numbers measure context usage, not billing, and do not establish semantic parity.

## Baseline

| Case | Mean range | Median range | p95 range |
| --- | ---: | ---: | ---: |
| Load rendered context | 0.103-0.113 ms | 0.066-0.080 ms | 0.140-0.176 ms |
| Message transform, cache hit | 0.217-0.326 ms | 0.186-0.253 ms | 0.363-0.971 ms |
| Startup warm, cache hit | 0.133-0.146 ms | 0.130-0.141 ms | 0.162-0.215 ms |
| Message transform, cache miss | 0.164-0.185 ms | 0.148-0.156 ms | 0.273-0.320 ms |
| System replacement | 0.047 ms | 0.042 ms | 0.069-0.092 ms |
| Cold pxpipe identity | 0.304-0.417 ms | 0.300-0.324 ms | 0.477-1.113 ms |
| Library first use, immediate | 579.249-629.600 ms | 556.350-630.696 ms | 728.679-745.330 ms |
| Library first use, after 100 ms | 42.189-96.942 ms | 41.714-48.590 ms | 46.531-530.019 ms |
| Library first use, after 500 ms | 44.805-52.075 ms | 44.805-50.671 ms | 52.033-69.831 ms |
| Startup warm, preloaded cache miss | 16.457-16.966 ms | 15.693-16.023 ms | 20.552-23.878 ms |
| Pxpipe cache-miss dispatch | 0.278-0.672 ms | 0.273-0.332 ms | 0.377-1.864 ms |
| Pxpipe cache ready | 23.664-30.416 ms | 22.528-29.647 ms | 28.128-41.131 ms |
| Warm pxpipe library render | 17.809-21.981 ms | 17.809-18.761 ms | 21.148-32.278 ms |
| Pxpipe CLI render | 399.624-408.671 ms | 404.709-405.924 ms | 422.012-440.592 ms |

The recurring cached path is sub-millisecond. Warm in-process rendering averages 18-22 ms, roughly 20 times faster than the CLI fallback. Library import remains expensive: immediate first use averaged 579-630 ms. After background preload, first rendering usually averages 42-52 ms; one 100 ms-delay run contained a cold outlier. Compare future results on the same host and inspect multiple runs before treating sub-millisecond differences as regressions.

Prompt and factsheet compaction did not materially regress the recurring path. Cache-hit transformation is no slower than the previous range. System replacement increased by about 0.01 ms while remaining below 0.05 ms. Since pxpipe changed from 0.2.0 to 0.7.1 between recorded baselines, renderer improvements cannot be attributed solely to plugin changes.

## Background Cache Warming

Immediately before this change, a warm in-process pxpipe render averaged 19.812 ms and was awaited by the cache-miss request. Background warming reduces request-path dispatch to 0.278-0.672 ms, at least 96.6% less preparation latency. The cache becomes usable after 23.664-30.416 ms, outside the measured request path.

The first call for a new source-content, renderer, and model cache key retains plaintext. Later calls use the image after publication succeeds. Identical misses share one task. At most two distinct background renders run concurrently; additional misses stay plaintext and retry after a slot opens. Rendering is deferred to a later event-loop turn but remains in the OpenCode process rather than a worker thread.

The plugin warms ambient instructions for the configured default model during startup. A cache hit adds 0.133-0.146 ms. A preloaded cache miss adds 16.457-16.966 ms. Startup waiting is capped at one second; if rendering is still incomplete, OpenCode continues and the render remains active in the background.

## Change From Initial Baseline

Replacing `pxpipe --version` with a SHA-256 identity of the resolved executable reduced cold cache-version lookup from 345.440-348.465 ms to 0.360-0.393 ms, about 99.9%. This removes roughly 347 ms from a first-process cache hit and from a first-process cache miss. Real rendering stayed near 400 ms.

Loading pxpipe's `runExportCore` into the plugin process reduced a warm render from 429.061-429.798 ms through the CLI to 21.538-22.865 ms through the library. The plugin falls back to `pxpipe export` when package discovery, import, or library rendering fails.

Starting package import and a tiny renderer warmup during plugin initialization reduced first-render latency after a 500 ms idle period from 608-615 ms to 40-41 ms. A 100 ms idle period was insufficient in one of ten samples per run.

Returning validated in-memory artifacts after successful cache publication, instead of reading them before and after rename, reduced warm library rendering from 20.760 ms immediately before the change to 16.474-17.320 ms afterward.
