# Browser Targets

Browser targets add read-only browser discovery and Hyprland window matching to `hypr-computer-use`. This does not duplicate Chrome DevTools MCP and does not assume the default browser is Chrome or Chromium.

## Modes

| Mode | Behavior |
| --- | --- |
| `browser-default` | Resolves the default browser desktop ID, desktop entry metadata, and normalized browser identity. |
| `browser-targets` | Resolves the default browser and matches it against current Hyprland clients. |
| `browser-capabilities` | Reports conservative capability status for the resolved browser target. |

## Discovery Sources

Default browser discovery uses these sources in order:

| Order | Source |
| ---: | --- |
| 1 | `xdg-settings get default-web-browser` |
| 2 | `xdg-mime query default x-scheme-handler/https` |
| 3 | `mimeapps.list` entries for `x-scheme-handler/https`, `x-scheme-handler/http`, then `text/html` |

Desktop entry resolution searches `$XDG_DATA_HOME/applications` and every `$XDG_DATA_DIRS` applications directory. Flatpak export paths work when they are present in `XDG_DATA_DIRS`.

## Normalized Identity

Browser identity includes:

| Field | Meaning |
| --- | --- |
| `desktopId` | Resolved desktop file ID, such as `app.zen_browser.zen.desktop`. |
| `name` | Desktop entry `Name`. |
| `exec` | Raw desktop entry `Exec` string. It is preserved, not executed. |
| `startupWMClass` | Desktop entry `StartupWMClass` when present. |
| `flatpakId` | Inferred Flatpak ID when available from desktop ID or exec metadata. |
| `classCandidates` | Browser class candidates used for Hyprland client matching. |
| `source` | Source that resolved the default browser. |
| `desktopEntryPath` | Path to the resolved desktop entry when found. |

## Capability Report

| Capability | Status Rules |
| --- | --- |
| `nativeWindowCapture` | `available` when at least one Hyprland client matches the browser identity. |
| `xdgOpen` | `available` when a default browser desktop ID is resolved. |
| `family` | `firefox-gecko` for Zen/Firefox-family browsers; otherwise `unknown`. |
| `protocols.cdp.support` | `unsupported` for Firefox-family browsers because current Firefox removed CDP support; otherwise `unknown`. |
| `protocols.webdriverBidi.support` | `supported` for Firefox-family browsers; otherwise `unknown`. |
| `protocols.webdriverBidi.endpoint` | `notConfigured`, `available`, `unreachable`, or `rejected`. Endpoint probing requires an explicit loopback WebSocket URL. |
| `protocols.marionette.support` | `supported` for Firefox-family browsers; this plugin does not use Marionette for detection. |

The capability report is intentionally conservative. Browser support and live endpoint availability are separate facts. A visible Zen or Firefox window means WebDriver BiDi is the right structured-control family, not that a BiDi endpoint is running.

## WebDriver BiDi Probing

Optional BiDi probing accepts only explicit loopback `ws:` or `wss:` endpoints, such as `ws://127.0.0.1:9222/session`. The probe sends only `session.status` and does not create a browser automation session.

Rejected probes include non-loopback hosts. The plugin does not scan common ports, launch browsers with remote-debugging flags, change browser preferences, inspect tabs, read cookies, or evaluate page scripts.

## Safety Boundary

Browser target modes are read-only. They do not launch browsers, open URLs, focus windows, click, type, inspect DOM content, read cookies, inspect storage, mutate profiles, create BiDi sessions, or enable remote debugging.

## Browser Interaction

Use dedicated browser automation tools for page interaction instead of adding browser control to this plugin. Prefer `agent-browser` for general browser automation tasks. Use `chrome-devtools` tools for Chromium/CDP workflows when those tools are available.

`hypr-computer-use` should stay focused on desktop visibility, target discovery, native window screenshots, and conservative capability reporting.
