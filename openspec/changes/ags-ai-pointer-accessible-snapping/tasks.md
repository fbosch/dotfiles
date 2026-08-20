## 1. Accessible Target Policy

- [x] 1.1 Add pure candidate validation, scoring, ambiguity rejection, and padded snap geometry.
- [x] 1.2 Add tests for confident, ambiguous, sensitive, invalid, and oversized candidates.
- [x] 1.3 Prefer a bounded collection over an enclosing common ancestor when an open stroke crosses several distinct targets.
- [x] 1.4 Preserve closed-region discovery when a hand-drawn loop overlaps only at its intended closure.
- [x] 1.5 Accept GTK `button` roles consistently in helper, click, and stroke policy.

## 2. Bounded Runtime Lookup

- [x] 2.1 Add a short-lived GJS AT-SPI helper limited to one active Hyprland client and bounded hit-test ancestry.
- [x] 2.2 Add parent-side subprocess timeout, cancellation, strict output validation, and window-to-global translation.

## 3. Workflow Integration

- [x] 3.1 Resolve accessibility after drawing teardown and before capture, preserving stroke geometry on every lookup failure.
- [x] 3.2 Show copied role/name metadata locally and clear it on cancellation and teardown.
- [x] 3.3 Resolve click-only gestures through exact point targeting with a monitor-clamped 256 by 256 fallback and bounded target context.

## 4. Validation

- [x] 4.1 Run focused pure and native GJS tests, AGS bundle/lint checks, strict OpenSpec validation, and Nix formatting/evaluation checks.
- [ ] 4.2 After a NixOS rebuild and fresh graphical login, manually verify supported and unsupported GTK, browser, Electron, and Qt applications.
