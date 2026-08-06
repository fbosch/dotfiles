# GJS/GLib Integration

## Spawning commands

```tsx
const GLib = imports.gi.GLib;

GLib.spawn_command_line_async("command arg1 arg2");

let [ok, output] = GLib.spawn_command_line_sync("command");
const decoder = new TextDecoder();
let result = JSON.parse(decoder.decode(output));
```

## Keyboard events

```tsx
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;

<Gtk.EventControllerKey
  onKeyPressed={(_, keyval) => {
    if (keyval === Gdk.KEY_Escape) {
      app.quit();
      return true;
    }
    return false;
  }}
/>
```

Common key constants:

- `Gdk.KEY_Escape`
- `Gdk.KEY_Return`
- `Gdk.KEY_Tab`
- `Gdk.KEY_space`

## Timeouts

```tsx
const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
  return GLib.SOURCE_REMOVE;
});

GLib.source_remove(timeout);
```

## Effect services

Effect is a good fit for long-lived services that own GLib sources, Gio cancellables, streams, monitors, signals, or retry loops. It makes interruption and teardown part of the service instead of scattering cleanup across callbacks. Keep ordinary GTK widget construction imperative.

- Provide a GLib-backed Effect scheduler once at the service runtime boundary. Do not replace Effect's scheduler globally.
- Wrap Gio asynchronous operations with `Effect.callback()` and the native callback/`*_finish` pair. Promise-returning Gio methods have stalled inside Effect fibers in this runtime.
- Return an interruption finalizer that cancels the `Gio.Cancellable`, removes owned GLib sources, closes streams or connections, and clears retained native objects.
- Keep native signal handlers synchronous when they must return a boolean or another immediate value. Start an Effect fiber from the handler instead of returning a Promise.
- Treat cancellation and resource release as separate operations. Cancelling a Gio wait does not release every resource it uses.

## File monitoring

```tsx
const Gio = imports.gi.Gio;

const file = Gio.File.new_for_path("/path/to/file");
const monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
monitor.connect("changed", (monitor, file, other_file, event_type) => {
  if (event_type === Gio.FileMonitorEvent.CHANGED) {
    // handle change
  }
});
```
