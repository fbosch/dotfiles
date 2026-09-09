# GTK Applications

## Read For

- GJS GTK/Adwaita application lifecycle, GtkBuilder templates, settings, user data, or application packaging.

## Version Gate

The upstream GTK tutorial is primarily GTK 3 and legacy `imports.gi`. Do not apply `Gtk.main()`, `show_all()`, GTK 3 container APIs, or synchronous `Dialog.run()` to GTK 4 code.

Determine GTK major version, GJS module regime, and whether the code is a standalone script or an application before writing UI code.

## Lifecycle

For an application, prefer `Gtk.Application` or `Adw.Application`:

- Use a valid reverse-DNS application ID.
- Build or present windows in `activate`.
- Expect activation more than once and reuse an active window when appropriate.
- Do not combine a manually-owned GTK main loop with application-managed lifecycle unless the target API requires it.

## Templates And Settings

- A GtkBuilder template needs a registered compatible class and a matching resource path.
- `InternalChildren` become underscored fields such as `this._childName`.
- Use GSettings for declared preferences and normal files for user data. The schema defines GVariant types.
- Build platform paths with GLib APIs rather than hard-coded separators.

## Packaging

`imports.package` and the accompanying Meson/GResource workflow are legacy material. Treat them as migration-only guidance. For a current application, derive packaging, resources, schemas, desktop entry, and translation handling from the existing project and its target runtime.

Source basis: GJS Guide `guides/gtk/**/*.md`. Some upstream GTK 3 data-saving and settings examples are incomplete; verify exact APIs against the target version.
