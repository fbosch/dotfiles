# GObject And GVariant

## Read For

- GObject subclasses, properties, signals, bindings, interfaces, GTypes, or GValues.
- D-Bus, GSettings, actions, menus, or any `GLib.Variant` payload.

## Native Object Rules

- Register JavaScript GObject subclasses with `GObject.registerClass()`.
- Declare native properties, signals, templates, and implemented interfaces in its metadata.
- Custom property setters must call `notify()` when the value changes.
- Construct properties in JavaScript using the project's convention; use canonical kebab-case inside string names such as `notify::property-name`.
- Signal callbacks receive the emitting object first. Keep handler IDs when disconnection is required.
- Bind-function identity matters: calling `bind()` again does not reproduce the function used to connect a signal.

## Interfaces And Types

- Native-library interfaces use required `vfunc_*` methods.
- Interfaces defined in GJS use their declared method names directly.
- Interface properties require `GObject.ParamSpec.override()`.
- `GObject.TYPE_JSOBJECT` is boxed data, not a GObject. It cannot satisfy APIs that require `GObject.Object`, including `Gio.ListModel` items.
- JavaScript `Number` cannot exactly represent all native 64-bit integer values. Do not claim `int64` or `uint64` fidelity beyond safe integers.
- Use `GObject.Value` only where native APIs require an explicitly typed value; GJS normally converts values automatically.

## GVariant Boundaries

- D-Bus calls, replies, properties, and signals use `GLib.Variant`.
- D-Bus methods always use tuple-shaped input and output, including empty tuples.
- D-Bus has no general `null` type.
- `unpack()`, `deepUnpack()`, and `recursiveUnpack()` have different depths. `recursiveUnpack()` discards type information needed to faithfully repack a value.
- GSettings types come from the installed schema; do not infer them from a current value.

Source basis: GJS Guide `guides/gobject/*.md` and `guides/glib/gvariant.md`.
