# GNOME Shell Version Matrix

## Read For

- Any extension task, to establish the correct module and preferences regime.
- Porting across Shell versions.

## Compatibility Regimes

| Target | Modules and lifecycle | Preferences |
| --- | --- | --- |
| 40-41 | Legacy `imports.*` and legacy entry points | GTK4 |
| 42-44 | Legacy `imports.*` and legacy entry points | GTK4 plus Libadwaita; `fillPreferencesWindow()` available |
| 45-50 | ESM with `Extension` and `ExtensionPreferences` classes | GTK4 plus Libadwaita |

GNOME Shell 44 to 45 is a parser-level boundary. Runtime feature checks cannot make one entry point valid on both sides. Publish separate artifacts when both regimes are required.

There is no dedicated GNOME Shell 41 porting guide in the source corpus. Do not infer that the release had no changes.

## Release Changes

| Release | Changes that affect implementation decisions |
| --- | --- |
| 40 | Major-only `shell-version`; preferences moved to GTK4; overview internals changed substantially |
| 42 | Added `session-modes`; preferences use Libadwaita and gained `fillPreferencesWindow()`; added `connectObject()` helpers |
| 43 | Replaced `aggregateMenu` with Quick Settings; Soup 3 became default; prefer `Signals.EventEmitter` |
| 44 | Shell can compile extension schemas; Quick Settings `label` became `title`; `Meta.later_*` moved to compositor laters |
| 45 | Mandatory ESM, `gi://` and `resource://` imports, default-exported extension classes, base-class settings and translation helpers |
| 46 | Removed `Clutter.Container`; moved Unix streams to GioUnix; changed St layout, notifications, Cairo helpers, and blur APIs |
| 47 | Preferences entry points may be async; `Clutter.Color` removed in favor of `Cogl.Color`; popup selection styling changed |
| 48 | Added `getLogger()`; removed `Clutter.Image` in favor of `St.ImageContent`; deprecated St `vertical`; moved compositor and cursor APIs |
| 49 | Removed `Meta.Rectangle` in favor of `Mtk.Rectangle`; disabled X11 by default; changed nested development to `--devkit --wayland`; removed click/tap actions |
| 50 | Removed X11 support and restart APIs; added `actor.easeAsync()` and cancellation behavior; added `gnome-shell-test-tool --extension` |

## Migration Workflow

1. Identify source and target releases from metadata and deployment requirements.
2. Determine whether the migration crosses 40, 42, or 45 architecture boundaries.
3. Read every upstream porting guide after the source through the target release.
4. Update module syntax and entry points before feature APIs.
5. Separate Shell and preferences imports.
6. Replace removed APIs; do not hide them behind optional chaining or `typeof` checks when the target guarantees the replacement.
7. Re-audit lifecycle cleanup and package metadata.
8. Test on the exact target release.

For Shell 50, the guide documents:

```sh
gnome-shell-test-tool --extension extension-package.zip tests/testMyExtension.js
```

Use it only when available in the target environment and when the project has compatible tests.

Source basis: [GNOME Shell 40-50 porting guides](https://gitlab.gnome.org/World/javascript/gjs-guide/-/tree/1c7e7cf693bb80327006f92b32c96bd3fa64d5cd/docs/extensions/upgrading) at GJS Guide commit `1c7e7cf`.
