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
