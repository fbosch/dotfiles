# GNOME Shell Foundations

## Read For

- Any GNOME Shell extension task.
- Extension anatomy, imports, process boundaries, metadata, or lifecycle.

## Establish The Target

Use the strongest available evidence in this order:

1. Explicit user or deployment target.
2. `metadata.json` `shell-version` entries.
3. CI, packaging, or release configuration.
4. Local `gnome-shell --version` only when the extension targets the local machine.

Do not infer support from syntax alone. Existing code may simply be unported. Use the version matrix to select the module and preferences regime.

## Package And Metadata

An extension package requires `metadata.json` and `extension.js`. Common optional content includes `prefs.js`, `stylesheet.css`, `schemas/`, and `locale/`. The installed directory name must equal the extension UUID.

Required metadata includes `uuid`, `name`, `description`, and `shell-version`. Use `settings-schema` and `gettext-domain` when the extension owns settings or translations. Treat metadata `version` as EGO-managed, not as a normal semantic version.

## Process Boundary

`extension.js` executes inside `gnome-shell`. It may access Shell, St, Clutter, and Meta, and any failure can destabilize the desktop.

`prefs.js` executes in a separate GJS process using GTK4 and Adwaita. It cannot access live Shell state. Shared modules imported by both processes must not import either process-specific UI stack.

## Lifecycle Contract

- GNOME Shell 45+ uses ESM and a default-exported `Extension` subclass.
- Put live object creation, signals, main-loop sources, injections, registrations, and UI changes in `enable()`.
- In `disable()`, reverse every operation, destroy owned UI, remove sources, disconnect signals, restore injections, and clear references.
- Assume repeated enable/disable transitions and disable calls during session-mode changes.
- Keep constructors metadata-oriented and side-effect-light. If overridden, call `super(metadata)`.
- Prefer stable GLib/GObject/Gio APIs and composition before Shell-internal replacement or prototype injection.
- Use `InjectionManager` when method injection is unavoidable and clear it during teardown.

## API Authority

Shell JavaScript modules are release-coupled internals, not a stable extension API. For `resource:///` imports, constructor signatures, styles, private fields, or underscore-prefixed properties:

1. Establish the exact Shell target.
2. Locate that release in the GNOME Shell source repository or distribution source package.
3. Inspect the matching module and its callers.
4. Do not substitute the `main` branch for target-release evidence.

Source basis: [extension overview](https://gitlab.gnome.org/World/javascript/gjs-guide/-/tree/1c7e7cf693bb80327006f92b32c96bd3fa64d5cd/docs/extensions/overview), `topics/extension.md`, and `review-guidelines/review-guidelines.md` at GJS Guide commit `1c7e7cf`.
