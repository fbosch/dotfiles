# GNOME Shell Review And EGO

## Read For

- Preparing or reviewing an extension for extensions.gnome.org (EGO).
- Metadata, privacy, subprocess, dependency, licensing, or generated-code decisions.

## Lifecycle And Process Requirements

- Create live GObjects, widgets, signals, and main-loop sources only from `enable()` or an enabled owner.
- Destroy objects, disconnect signals, remove every source, restore injections, and clear retained state during `disable()`.
- Do not call `run_dispose()` without a documented real-world reason.
- Keep Gtk/Gdk/Adw out of Shell code and Clutter/Meta/St/Shell out of preferences.
- Do not use deprecated GJS `ByteArray`, `Lang`, or `Mainloop` modules in submitted current code.

## Reviewability

- Do not submit minified, obfuscated, placeholder-heavy, or unexplained generated JavaScript.
- TypeScript output must be readable and formatted; the maintainer must understand and support it.
- Keep entry points small, `enable()` and `disable()` adjacent, and resource ownership local to the class that creates it.
- Avoid defensive noise such as broad empty `try/catch`, speculative optional chaining, and `_enabled` or `_destroyed` flags that conceal lifecycle bugs.
- Remove unnecessary build scripts, translation sources, icons, and other files not needed at runtime.

For AI-generated extension files intended only for personal use, the guide requires this notice:

```js
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.
```

## Metadata And Packaging

- Use a valid `extension-id@namespace` UUID; do not use `gnome.org` as the namespace.
- List only tested stable Shell releases and at most one development release. Never claim future support.
- Do not manually manage metadata `version` as a semantic version; use `version-name` for a developer-facing label.
- Omit unused metadata, including `session-modes` when only `user` is needed.
- Extension-owned schemas use the `org.gnome.shell.extensions` ID and `/org/gnome/shell/extensions` path bases and ship as `<schema-id>.gschema.xml`.

## Security, Privacy, And External Code

- Prefer D-Bus over subprocesses and move heavy work out of the Shell process.
- Do not bundle executable binaries or install npm, pip, or other dependencies without explicit user action.
- Avoid privileged subprocesses. If unavoidable, use `pkexec` and never elevate a user-writable program or script.
- Declare clipboard access in the extension description. Do not share clipboard contents without an explicit user action or bind default shortcuts that operate on clipboard data.
- User-tracking telemetry and undisclosed data sharing are prohibited.
- Do not control other extensions or the extension system without a narrowly justified, reviewable requirement.

## Licensing

Shell extensions distributed through EGO are derived works of GPL-2.0-or-later GNOME Shell and require compatible distribution terms. Attribute copied code and include only assets the project is allowed to redistribute.

Source basis: [review guidelines](https://gitlab.gnome.org/World/javascript/gjs-guide/-/tree/1c7e7cf693bb80327006f92b32c96bd3fa64d5cd/docs/extensions/review-guidelines) at GJS Guide commit `1c7e7cf`.
