## Context

The first `hypr-computer-use` slice provides read-only Hyprland state, target snapshots, screenshots, and evidence logging. The next browser-related slice should not duplicate Chrome DevTools MCP. Instead, it should discover browser targets generically and report which control paths are plausible for the current browser.

On this system, XDG resolves the default browser to `app.zen_browser.zen.desktop`, and the active Hyprland browser window reports class `app.zen_browser.zen`. Zen is Firefox-based and installed as Flatpak, so assuming CDP would be wrong. Browser targeting must separate browser discovery from browser automation.

## Goals / Non-Goals

**Goals:**

- Discover the default browser from XDG sources without hardcoding a browser.
- Resolve browser desktop entries from XDG data directories, including Flatpak export paths present in `XDG_DATA_DIRS`.
- Normalize browser identity for evidence and Hyprland client matching.
- Match discovered browser identities to current Hyprland clients using the existing read-only state adapter.
- Report likely capabilities such as native Hyprland window capture, XDG URL opening availability, CDP status, and WebDriver BiDi status.
- Preserve metadata-first evidence logging.

**Non-Goals:**

- No URL opening or browser launch in this slice.
- No DOM automation, click, fill, form submission, or script execution.
- No browser profile creation, profile mutation, or remote-debugging flag injection.
- No credential, cookie, local storage, or session inspection.
- No dependency on Chrome/Chromium, WebDriver, or browser-specific SDKs.

## Decisions

### Use XDG default browser resolution first

The implementation will discover the default browser using existing system sources in this order: `xdg-settings get default-web-browser`, `xdg-mime query default x-scheme-handler/https`, then `mimeapps.list` parsing.

Alternatives considered:

- Hardcode configured browsers: rejected because the user asked for browser agnosticism and local XDG already exposes the default.
- Prefer active Hyprland window only: rejected because the active window may not be a browser or may not be the default browser.

### Resolve desktop entries without executing them

Desktop entry resolution will search `$XDG_DATA_HOME/applications` and each `$XDG_DATA_DIRS` application directory. It will parse only metadata fields needed for identity and matching.

Alternatives considered:

- Use `gio` or desktop-file libraries: rejected because those commands/libraries may not be installed and would add dependency pressure.
- Parse every desktop key: rejected because the plugin only needs a small, testable subset.

### Treat browser automation protocols as reported capabilities

The capability report will mark `nativeWindowCapture` as available when a matching Hyprland client exists, `xdgOpen` as available when a default browser desktop ID resolves, and `cdp` / `webdriverBidi` as `unknown` unless explicit endpoint discovery is added later.

Alternatives considered:

- Claim CDP for all browsers: rejected because Firefox/Zen do not share Chrome DevTools MCP semantics.
- Probe ports aggressively: rejected because this slice is read-only metadata discovery, not network/service probing.

### Keep URL opening out of scope

Opening a URL is useful, but it is side-effecting: it can launch apps, create windows, and load signed-in sessions. It should come after target policy.

Alternatives considered:

- Add `open-url` now: rejected because the current plugin boundary is read-only and policy approval is not implemented yet.

## Risks / Trade-offs

- XDG tools may be missing -> Fall back to MIME file parsing and report unresolved defaults clearly.
- Desktop IDs can point to missing desktop files -> Return the desktop ID with `desktopEntry: null` rather than guessing.
- `StartupWMClass` can differ from Hyprland `class` -> Match against multiple class candidates including desktop ID, Flatpak ID, `StartupWMClass`, and executable-derived names.
- Browser protocol availability can be misclassified -> Report `unknown` instead of overclaiming.
- Flatpak desktop entries contain complex `Exec=` placeholders -> Preserve the raw exec string and do not execute it in this slice.

## Migration Plan

This is additive. No existing browser behavior exists in `hypr-computer-use`, and the existing read-only state/capture modes remain unchanged.

Rollback is removing the browser target modes and related modules/docs. No persisted user data migration is required.

## Open Questions

- Should a later side-effecting `open-url` mode use `xdg-open`, desktop-entry execution, or an explicit configured command?
- Should protocol discovery later include localhost CDP/WebDriver probing, or only configured endpoints?
