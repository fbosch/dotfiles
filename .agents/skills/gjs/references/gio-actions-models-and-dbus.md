# Gio Actions, Models, And D-Bus

## Read For

- Actions, menus, list models, D-Bus clients, D-Bus services, or exporting models over D-Bus.

## Actions And Menus

- Actions have parameter and state types expressed as `GLib.Variant` signatures, not arbitrary JavaScript values.
- A `change-state` handler owns the change: call `set_state()` only after accepting the new state.
- Use the appropriate action scope such as `app.*`, `win.*`, or an inserted contextual group.
- Appending a `Gio.MenuItem` snapshots it into the model; later mutation of the original item does not change the menu.
- Menu and list `items-changed` notifications occur after mutation. Removed items are no longer queryable; process removals before additions at the same position.

## List Models

Use `Gio.ListStore` unless a custom model is necessary. A custom `Gio.ListModel` must:

- Be a `GObject.Object` implementing `Gio.ListModel`.
- Implement `vfunc_get_item()`, `vfunc_get_item_type()`, and `vfunc_get_n_items()`.
- Change backing state before `items_changed()`.
- Return only `GObject.Object` items; JavaScript boxed values do not qualify.

## D-Bus

Choose the narrowest client API:

- `Gio.DBusProxy.makeProxyWrapper()` for an interface-specific GJS proxy.
- `Gio.DBusProxy` for configurable proxy behavior.
- `Gio.DBusConnection.call()` for isolated direct calls.

Avoid synchronous proxy construction on UI paths. Wrapper signals use `connectSignal()` rather than ordinary GObject signal names.

For a service, own the name, export the object before clients observe readiness, retain the name/export IDs, and unown/unexport on teardown. `Gio.DBusExportedObject.wrapJSObject()` creates a separate export object: JavaScript property mutation does not automatically emit D-Bus property changes or signals.

Source basis: GJS Guide `guides/gio/actions-and-menus.md`, `guides/gio/list-models.md`, and `guides/gio/dbus.md`.
