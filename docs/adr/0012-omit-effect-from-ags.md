# Omit Effect From AGS

**Status:** accepted
**Date:** 2026-08-06

## Context

AGS is a long-lived desktop process where startup latency, bundle size, and resident memory directly affect the session. Even with Effect v4 direct subpath imports, the focus-history pilot added about 3.42 MB to the isolated bundle, 212 ms to median cold startup, and 6.8 MiB to idle proportional set size compared with equivalent Gio callbacks. Effect also did not replace the GJS-specific work of finishing Gio callbacks and explicitly owning cancellables, streams, connections, and GLib sources.

## Decision

Omit Effect from AGS and implement asynchronous service lifecycles with Gio callback/`*_finish` APIs, `Gio.Cancellable`, and explicitly owned GLib sources. Preserve generation-bound disposal, stale-callback guards, independent resource cleanup, and bounded reconnect behavior without loading a general-purpose effect runtime into the desktop shell.

## Alternatives Considered

Effect's root import was rejected because it produced the largest bundle and runtime overhead. Direct v4 subpath imports reduced Effect's startup, memory, and artifact costs by roughly 30–40%, but remained materially heavier than imperative Gio. Lazy loading was rejected because session-scoped focus history must begin when AGS starts and deferring the cost would either lose history or move latency to the first desktop interaction.

## Consequences

AGS has a smaller bundle, lower startup cost, and lower idle memory usage. Native resource ownership and retry logic remain explicit and require focused lifecycle validation, while Effect-specific dependencies and guidance are removed. Future asynchronous IPC work should prefer non-blocking Gio APIs without adding a runtime unless measured benefits justify the desktop-wide cost.
