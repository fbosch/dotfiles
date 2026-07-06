## 1. Browser Contracts

- [x] 1.1 Define browser discovery, desktop entry, browser identity, target match, and capability report types.
- [x] 1.2 Define browser-target modes for the existing read-only tool.

## 2. XDG Browser Discovery

- [x] 2.1 Implement default browser discovery using `xdg-settings`, `xdg-mime`, and `mimeapps.list` fallback order.
- [x] 2.2 Implement XDG application directory discovery from `XDG_DATA_HOME` and `XDG_DATA_DIRS`.
- [x] 2.3 Implement desktop entry lookup and field parsing for the required metadata subset.

## 3. Browser Identity and Matching

- [x] 3.1 Normalize browser identity from desktop ID and desktop entry metadata.
- [x] 3.2 Infer Flatpak ID and class candidates without hardcoding specific browsers.
- [x] 3.3 Match normalized browser identity against current Hyprland clients.
- [x] 3.4 Produce conservative capability reports for native window capture, XDG open, CDP, and WebDriver BiDi.

## 4. Tool Integration and Evidence

- [x] 4.1 Add `browser-default`, `browser-targets`, and `browser-capabilities` modes to `hypr_computer_use_readonly`.
- [x] 4.2 Write metadata-first evidence records for browser discovery and target matching.
- [x] 4.3 Preserve read-only behavior by avoiding browser launch, URL opening, DOM inspection, and input automation.

## 5. Tests and Docs

- [x] 5.1 Add fixture-based tests for MIME fallback, desktop entry parsing, identity normalization, and Hyprland client matching.
- [x] 5.2 Add plugin docs for browser targets and capability reporting.
- [x] 5.3 Run focused tests and plugin typechecks.
- [x] 5.4 Run a live smoke check that resolves the local default browser and matches the visible Zen browser window.
