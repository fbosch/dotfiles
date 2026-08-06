---
name: gjs
description: "Author, review, debug, port, and package code that explicitly runs under GJS (GNOME JavaScript), including GNOME Shell extensions and JavaScript or TypeScript projects using `gi://`, `resource:///org/gnome/`, legacy `imports.gi`, `GObject.registerClass()`, Gio/GLib/GObject, GTK/Adwaita, GSettings, or GJS D-Bus. Use only when the request, repository, imports, or target process establishes GJS/GNOME runtime context. Do not use for ordinary JavaScript or TypeScript, browser/frontend code, Node.js, Bun, Deno, Electron, generic language/tooling questions, or GNOME APIs used from C, Rust, Python, Vala, or another non-GJS language."
---

# GJS

Treat GJS as a GNOME runtime with GObject Introspection and the GLib main loop, not as browser or Node.js JavaScript. Keep target-runtime facts separate from ordinary JavaScript advice.

## Scope Gate

Use this skill only with positive GJS evidence, such as:

- `gjs`, `GNOME JavaScript`, `GNOME Shell extension`, or `gnome-extensions`
- `gi://`, `resource:///org/gnome/`, `imports.gi`, `imports.ui`, or `imports.package`
- `GObject.registerClass()`, `Gio._promisify()`, `GLib.SOURCE_REMOVE`, or `Gio.DBusProxy.makeProxyWrapper()`
- JavaScript or TypeScript using GNOME libraries through GObject Introspection
- An extension's `metadata.json`, `extension.js`, `prefs.js`, `shell-version`, UUID, or EGO packaging

Do not activate for JavaScript or TypeScript language features alone. `async`, `Promise`, `import`, `class`, `interface`, ESM, ESLint, D-Bus, GTK, GObject, or GSettings are insufficient without GJS context.

## Required Classification

Before selecting APIs, establish:

- **Runtime:** standalone script, GTK/Adwaita application, Shell extension, or extension preferences.
- **Module regime:** modern ESM or legacy `imports.*`.
- **Target:** GJS and GTK versions; for extensions, the exact GNOME Shell version.
- **Compatibility:** one target, bounded range, or migration.

Read existing metadata, imports, build tooling, and deployment targets before guessing. For Shell work, crossing GNOME Shell 44 to 45 requires separately built legacy and ESM artifacts; a runtime check cannot bridge a parser-level module boundary.

## Core Rules

- Do not introduce DOM, browser Fetch, Node built-ins, npm assumptions, or browser event-loop patterns without an explicit compatible layer.
- Prefer non-blocking Gio APIs in GTK and Shell processes. GJS dispatches JavaScript through the GLib main loop.
- Treat timeout/idle IDs, signal IDs, file monitors, cancellables, D-Bus ownership IDs, exported objects, and injected methods as owned resources. Preserve and release them with their owner.
- Register native-facing subclasses with `GObject.registerClass()`. Use GObject naming rules: string identifiers retain canonical kebab-case; JavaScript property access follows the local GJS convention.
- Do not use an `async` function as a signal handler that must return a native boolean or other immediate value. It returns a Promise, which can be coerced incorrectly.
- Preserve exact GVariant types at D-Bus, GSettings, action, and menu boundaries. D-Bus arguments and replies are tuples and D-Bus has no general `null`.
- Treat JavaScript `Number` as lossy for native 64-bit values outside its safe integer range.
- Do not copy historical tutorial code into a modern project without checking its target version and module regime.

## GNOME Shell Rules

- Keep Shell-process and preferences-process code separate. `extension.js` may use Shell, St, Clutter, and Meta; `prefs.js` uses GTK4/Adwaita and cannot access the live Shell.
- Perform live Shell setup in `enable()` and undo every registration, source, signal, injection, and UI addition in `disable()`. Assume these transitions repeat and may occur during session-mode changes.
- Keep constructors side-effect-light. If overriding one, pass metadata to `super(metadata)`.
- Treat `resource:///org/gnome/shell/` modules, private fields, prototype replacement, and underscore-prefixed APIs as target-release-specific. Verify them against the target Shell tag, not GNOME Shell `main`.
- Re-enabling an extension does not unload JavaScript modules. Test source reloads in a new Shell process.
- A nested Shell is a development environment, not an isolation boundary.

## Reference Routing

After classification, read every reference listed for the scenario before substantive analysis or action:

| Scenario | Mandatory references |
| --- | --- |
| Any GJS task | [runtime-and-modules.md](references/runtime-and-modules.md) |
| Promises, Gio async methods, timers, cancellation, leaks, Cairo | [main-loop-and-lifecycle.md](references/main-loop-and-lifecycle.md) |
| GObject classes, properties, signals, interfaces, GTypes, GVariants | [gobject-and-gvariant.md](references/gobject-and-gvariant.md) |
| Files, streams, file monitors, subprocesses | [gio-files-and-subprocesses.md](references/gio-files-and-subprocesses.md) plus lifecycle guidance when asynchronous or long-lived |
| Actions, menus, list models, D-Bus clients or services | [gio-actions-models-and-dbus.md](references/gio-actions-models-and-dbus.md) plus [gobject-and-gvariant.md](references/gobject-and-gvariant.md) |
| GTK application lifecycle, templates, settings, packaged applications | [gtk-applications.md](references/gtk-applications.md) plus lifecycle guidance for owned resources |
| Any GNOME Shell extension | [shell-foundations.md](references/shell-foundations.md) and [shell-version-matrix.md](references/shell-version-matrix.md) |
| Shell UI, preferences, translations, TypeScript, testing, or debugging | [shell-development-and-features.md](references/shell-development-and-features.md) plus the Shell foundations and version matrix |
| Shell migration | Shell foundations and version matrix; read every upstream porting guide between source and target |
| EGO submission, extension review, privacy, licensing, or generated code | [shell-review-and-ego.md](references/shell-review-and-ego.md) plus Shell foundations |

Do not load GTK application guidance for Shell-only UI changes. Do not load Shell references for ordinary GJS applications. Do not load EGO policy for a private extension unless packaging, privacy, licensing, or reviewability is relevant.

## Validation

- Record the target with `gjs --version` and, for local Shell work, `gnome-shell --version`; project metadata or deployment targets take precedence over the local machine.
- Run the project-provided build, lint, test, or packaging path when one exists. Do not execute an unfamiliar GJS entry point merely as a syntax check because it may perform desktop-side effects.
- Confirm import/module syntax matches the declared runtime before behavioral testing.
- For lifecycle work, verify setup and cleanup together: enable/disable, source removal, signal disconnection, cancellation, and object release.
- For an extension, verify package contents with `gnome-extensions pack` when packaging is in scope. Test preferences with `gnome-extensions prefs <uuid>` and test Shell code in a fresh process appropriate to the target release.
- Validate Shell-private APIs against the source for the declared release, not only against the locally installed or upstream `main` version.

## Never

- Never use this skill for regular JavaScript/TypeScript merely because the file extension is `.js` or `.ts`.
- Never mix legacy `imports.*`, modern ESM, GTK 3, GTK 4, and `imports.package` patterns without verified project intent.
- Never mix Gtk/Gdk/Adw imports into the Shell process, or St/Clutter/Meta/Shell imports into preferences.
- Never leave repeating sources, signal connections, monitors, D-Bus resources, or Shell modifications without an explicit cleanup owner.
- Never add speculative version checks, optional chaining, or broad catch-and-ignore blocks to conceal an unverified target API.
- Never submit generated extension code to extensions.gnome.org without verifying maintenance, lifecycle, policy, licensing, privacy, and packaging requirements.

## Source Basis

This is a corrected, condensed guide to the [GJS Guide](https://gitlab.gnome.org/World/javascript/gjs-guide/-/tree/1c7e7cf693bb80327006f92b32c96bd3fa64d5cd/docs) at commit `1c7e7cf`. Treat the bundled references as routing and safety guidance; consult target-version GJS, GTK, and GNOME Shell API documentation for exact signatures.
