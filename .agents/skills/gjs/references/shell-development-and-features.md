# GNOME Shell Development And Features

## Read For

- Creating, testing, debugging, or packaging an extension.
- Preferences, translations, TypeScript, accessibility, Shell UI, notifications, search, or session modes.

## Development Workflow

1. Establish the exact Shell target and read the version matrix.
2. Create or inspect the UUID directory and `metadata.json` before changing entry points.
3. Pair every setup operation with its cleanup owner before implementation.
4. Test changed source in a new Shell process; re-enabling does not unload imported JavaScript.
5. Exercise repeated enable/disable and preferences independently.

Useful target-dependent commands:

```sh
gnome-extensions create --interactive
gnome-extensions enable <uuid>
gnome-extensions prefs <uuid>
gnome-extensions pack <extension-directory>
```

For GNOME 49+ Wayland development, the guide uses:

```sh
dbus-run-session gnome-shell --devkit --wayland
```

GNOME 48 and earlier used `--nested --wayland`. Do not apply the old nested or X11 restart workflow to GNOME 49+; GNOME Shell 50 removed X11 support. A nested Shell is not a sandbox.

Follow Shell logs with:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

Follow preferences-process logs with:

```sh
journalctl -f -o cat /usr/bin/gjs
```

Escalate from focused `console.debug()`, `console.warn()`, and `console.error()` output to Looking Glass, `SHELL_DEBUG`, and finally GDB for native crashes. A standalone GJS console cannot access the live Shell process.

## Preferences And Settings

- GNOME 45+ preferences default-export an `ExtensionPreferences` subclass.
- Build GTK4/Adwaita UI in `fillPreferencesWindow()`; never import Shell UI modules into preferences.
- Declare `settings-schema` in metadata and use `getSettings()` from each process.
- Test with `gnome-extensions prefs <uuid>` and observe settings with `dconf watch` when diagnosing propagation.
- Compatible installers compile extension-local schemas for GNOME 44+; package schema XML, not `gschemas.compiled`, when targeting only those releases.

## Feature Routing

| Feature | Key contract |
| --- | --- |
| Quick Settings | Add `SystemIndicator` items through supported panel registration; avoid private action-button object chains |
| Popup menus | Verify whether a class is a GObject before using property binding; some Shell menu classes are plain JavaScript |
| Dialogs | Use Shell St/Clutter dialogs in `extension.js`, not GTK dialogs |
| Notifications | Retain and destroy custom sources; use `Main.notify()` only for simple notifications |
| Search providers | Return stable result IDs, map them to metadata, and unregister the provider in `disable()` |
| Session modes | Expect lifecycle transitions; require explicit justification for `unlock-dialog` and never treat `gdm` as a normal user-extension mode |
| Accessibility | Prefer standard St widgets; custom UI must provide roles, names, states, relationships, and keyboard focus behavior |
| Translations | Declare `gettext-domain`, mark strings deliberately, regenerate catalogs, and package locale output |
| TypeScript | Treat TypeScript as build-time only; Shell executes generated JavaScript, which must remain readable and match the target GIR APIs |

Verify each feature against the target-release Shell source before using internal classes or properties.

Source basis: [extension development](https://gitlab.gnome.org/World/javascript/gjs-guide/-/tree/1c7e7cf693bb80327006f92b32c96bd3fa64d5cd/docs/extensions/development) and [extension topics](https://gitlab.gnome.org/World/javascript/gjs-guide/-/tree/1c7e7cf693bb80327006f92b32c96bd3fa64d5cd/docs/extensions/topics) at GJS Guide commit `1c7e7cf`.
