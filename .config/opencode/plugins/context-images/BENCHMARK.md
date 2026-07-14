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

The cache-miss case stubs rendering. It measures plugin overhead through render dispatch, not pxpipe. The pxpipe cases measure cold executable identity detection and the full library and CLI render paths, including cache publication and artifact reload.

The benchmark reports pxpipe's portable SHA-256 executable identity because pxpipe 0.7.1 has a stale `0.2.0` command fallback.

## Context Savings

The active bundle contains the global and project `AGENTS.md` files plus the three local files in `config.instructions`. With the current source contents and compact prompt:

| Representation | Tokens |
| --- | ---: |
| OpenCode-wrapped plaintext (`o200k_base`) | 2,849 |
| Inline prompt and exact-string index (`o200k_base`) | 195 |
| System authority marker (`o200k_base`) | 15 |
| PNG input (provider-accounted) | approximately 851 |
| **Complete image replacement** | **approximately 1,061** |

The replacement saves approximately 1,788 input-context tokens per qualifying model call, or 62.8% of this instruction block. The compact prompt and marker remain at 210 text tokens, down from 366 before compaction.

This snapshot uses 14,360 source characters and one unchanged 1568×384 PNG (`sha256:6693cd806edd`). A fresh OpenCode process completed replacement without a mismatch. The PNG figure comes from the controlled provider usage measurement for that byte-identical page; pxpipe's manifest estimate is lower and is not used in the total. These numbers measure context usage, not billing, and do not establish semantic parity.

## Baseline

| Case | Mean range | Median range | p95 range |
| --- | ---: | ---: | ---: |
| Load rendered context | 0.104-0.117 ms | 0.081-0.091 ms | 0.127-0.162 ms |
| Message transform, cache hit | 0.249-0.306 ms | 0.232-0.237 ms | 0.333-0.405 ms |
| Message transform, cache miss | 0.155-0.161 ms | 0.118-0.152 ms | 0.218-0.237 ms |
| System replacement | 0.046-0.047 ms | 0.042-0.046 ms | 0.077-0.088 ms |
| Cold pxpipe identity | 0.336-0.346 ms | 0.285-0.335 ms | 0.443-0.606 ms |
| Library first use, immediate | 561.955-622.589 ms | 559.772-579.496 ms | 586.069-994.833 ms |
| Library first use, after 100 ms | 41.668-43.917 ms | 41.940-44.239 ms | 45.130-50.727 ms |
| Library first use, after 500 ms | 41.786-43.695 ms | 40.589-44.170 ms | 46.430-52.100 ms |
| Warm pxpipe library render | 17.201-19.079 ms | 16.458-18.099 ms | 21.401-24.193 ms |
| Pxpipe CLI render | 374.595-386.871 ms | 370.576-378.305 ms | 411.253-422.447 ms |

The recurring cached path is sub-millisecond. Warm in-process rendering averages 17-19 ms, roughly 21 times faster than the CLI fallback. Library import remains expensive and variable: immediate first use averaged 562-623 ms, with one cold p95 outlier near 995 ms. After background preload, first-request rendering averages 42-44 ms. Compare future results on the same host and inspect multiple runs before treating sub-millisecond differences as regressions.

Prompt and factsheet compaction did not materially regress the recurring path. Cache-hit transformation is no slower than the previous range. System replacement increased by about 0.01 ms while remaining below 0.05 ms. Since pxpipe changed from 0.2.0 to 0.7.1 between recorded baselines, renderer improvements cannot be attributed solely to plugin changes.

## Change From Initial Baseline

Replacing `pxpipe --version` with a SHA-256 identity of the resolved executable reduced cold cache-version lookup from 345.440-348.465 ms to 0.360-0.393 ms, about 99.9%. This removes roughly 347 ms from a first-process cache hit and from a first-process cache miss. Real rendering stayed near 400 ms.

Loading pxpipe's `runExportCore` into the plugin process reduced a warm render from 429.061-429.798 ms through the CLI to 21.538-22.865 ms through the library. The plugin falls back to `pxpipe export` when package discovery, import, or library rendering fails.

Starting package import and a tiny renderer warmup during plugin initialization reduced first-render latency after a 500 ms idle period from 608-615 ms to 40-41 ms. A 100 ms idle period was insufficient in one of ten samples per run.

Returning validated in-memory artifacts after successful cache publication, instead of reading them before and after rename, reduced warm library rendering from 20.760 ms immediately before the change to 16.474-17.320 ms afterward.
