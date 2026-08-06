# Main Loop And Lifecycle

## Read For

- Gio asynchronous operations, Promises, timers, idle work, or cancellation.
- Leaks, stale callbacks, destroyed objects, extension teardown, or Cairo drawing.

## Main-Loop Model

GJS JavaScript runs on one thread through GLib's main loop. Gio may perform work elsewhere, then schedule completion on the caller's main context. Do not block GTK or Shell paths with synchronous I/O, proxy construction, or expensive computation.

Use `Gio.Application.run()` for application loops. Shell extensions inherit the existing Shell loop. Standalone scripts can use `GLib.MainLoop` deliberately.

## Async Ownership

- Store IDs from `GLib.timeout_add()` and `GLib.idle_add()`; remove them with `GLib.Source.remove()` when their owner ends.
- Return `GLib.SOURCE_REMOVE` for one-shot callbacks and `GLib.SOURCE_CONTINUE` only when continued scheduling is intended.
- Use `Gio.Cancellable` for Gio operations. A cancelled cancellable cannot be reused.
- Cancellation and source removal are different operations. Cancelling a Gio wait does not automatically stop the underlying process or resource.
- `Gio._promisify()` changes the method on a class prototype. Omitting the callback selects Promise behavior; supplying one retains callback behavior.

## GObject And JavaScript Lifetime

GJS combines JavaScript tracing with GObject reference counting. Keep cleanup handles reachable until cleanup is complete:

- Disconnect signals from long-lived emitters.
- Retain file monitors and exported objects for the lifetime they must work.
- Clear references after native APIs destroy/finalize an object.
- Avoid closures that retain owner state after its lifecycle ends.
- Explicitly clean up Cairo contexts after drawing.

An `async` signal callback always returns a Promise. Do not attach it directly to a signal requiring a boolean or another immediate native return; start asynchronous work from a synchronous handler and return the required value directly.

Source basis: GJS Guide `guides/gjs/asynchronous-programming.md` and `guides/gjs/memory-management.md`.
