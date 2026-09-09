# Runtime And Modules

## Read For

- Determining whether code runs under GJS.
- Selecting ESM, legacy imports, or GNOME Shell resource imports.
- Checking runtime-global or syntax availability.

## Runtime Boundary

GJS exposes GNOME libraries through GObject Introspection and runs JavaScript on the GLib main loop. It is not a browser and does not provide the DOM or most Web APIs. It is not Node.js and does not provide Node built-ins or package-resolution semantics.

Some browser-like globals arrived only in GJS 1.70 / GNOME 41: Console, `TextEncoder`, `TextDecoder`, and timers. Confirm the target before relying on them.

## Module Decision

| Project evidence | Use |
| --- | --- |
| Current GJS code with `gi://` or native ESM | ESM |
| GNOME Shell 45+ extension | ESM and default-exported extension classes |
| Existing `imports.gi`, `imports.ui`, or `imports.package` | Legacy regime; preserve until an explicit migration |
| GNOME Shell 44 or earlier | Legacy extension modules |

Examples of runtime-specific imports:

```js
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
```

Do not construct Shell resource paths from memory. Shell and preferences processes use distinct, case-sensitive resource roots. Check the target Shell source.

## Style Rules

- Prefer ESM exports and standard classes for modern targets.
- Preserve a repository's existing property-access convention. Strings such as `notify::property-name` use canonical GObject names even where JavaScript access is camel-case.
- Set known GObject properties at construction when practical to avoid redundant notifications.
- Use `Gio._promisify()` for Gio methods rather than reinventing generic wrappers.

## Version Gates

- ESM: GJS 1.68 / GNOME 40.
- Standard GObject `constructor()`: GJS 1.72 / GNOME 42. Older targets use `_init()`.
- `GObject.Value(type, value)`: GJS 1.84 / GNOME 48.
- GNOME Shell ESM extensions: GNOME 45+.

Source basis: GJS Guide `guides/gjs/intro.md`, `guides/gjs/style-guide.md`, and extension `overview/imports-and-modules.md`.
