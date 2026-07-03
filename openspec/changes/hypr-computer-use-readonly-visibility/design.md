## Context

The `hypr-computer-use` plugin area currently contains research documents comparing Codex Computer Use with what is practical on Linux/Hyprland. The first implementation slice should be read-only: discover compositor state, capture visual evidence, and produce a stable target snapshot for future workflows.

Hyprland is a good fit for read-only state because `hyprctl` exposes clients, monitors, workspaces, and active-window metadata. Screenshots are also feasible through configured local tools or portal-backed capture. The unsafe boundary is input: generic clicking and typing on Wayland require privileged or compositor-mediated paths and are explicitly out of scope for this change.

## Goals / Non-Goals

**Goals:**

- Provide a read-only view of Hyprland monitors, workspaces, clients, and active window state.
- Normalize target identity into a snapshot future tools can verify before taking any action.
- Capture visual evidence using explicit scopes: active window, monitor, region, and full desktop where supported.
- Record task-local evidence metadata: timestamp, scope, target metadata, output path, and capture method.
- Fail closed when Hyprland state is unavailable, target identity is ambiguous, or capture scope cannot be resolved.

**Non-Goals:**

- No clicking, typing, pointer movement, keyboard injection, or compositor-dispatch mutations.
- No clipboard reads or writes.
- No privileged helpers, uinput, virtual keyboard, virtual pointer, or lockscreen integration.
- No package installation or Nix/system dependency management in this repo.
- No generic OCR, vision interpretation, browser automation, or app-specific workflow automation in this slice.

## Decisions

### Use Hyprland IPC as the state source

The visibility layer will read Hyprland state through `hyprctl` JSON commands, starting with active window, clients, monitors, and workspaces.

Alternatives considered:

- Screenshot-only targeting: rejected because screenshots alone cannot reliably identify the app, PID, workspace, monitor, or stable window address.
- Accessibility tree inspection: deferred because Linux accessibility support is app-dependent and not required for the read-only foundation.

### Represent the active target as a snapshot, not a live handle

Each visibility operation produces a target snapshot with window address, class, title, PID when available, workspace, monitor, geometry, fullscreen/floating state, and capture metadata when a screenshot is taken.

Alternatives considered:

- Store only the active window address: rejected because later safety checks need enough context to detect stale or wrong-target state.
- Store raw `hyprctl` output only: rejected because future tools need a stable, smaller contract rather than compositor-specific payloads everywhere.

### Keep capture scopes explicit

Screenshot capture will require an explicit scope: `active-window`, `monitor`, `region`, or `full`. The implementation should avoid silently widening scope when a narrower scope fails.

Alternatives considered:

- Always capture the full desktop: rejected because it exposes more unrelated content than necessary.
- Always prompt for a region: rejected because active-window and monitor captures are useful for repeatable verification.

### Treat screenshot tools as configured capabilities

The repo should not install screenshot dependencies. The implementation should detect configured tools and report missing capabilities with actionable errors.

Alternatives considered:

- Add package configuration here: rejected because this dotfiles repo does not manage system packages.
- Require a single screenshot backend: rejected because Hyprland setups vary between portal, grim/slurp, hyprshot, and browser-native capture paths.

### Log evidence without logging sensitive image contents inline

Evidence logs should record metadata and file paths, not duplicate image data or clipboard content. Screenshots remain files that can be inspected explicitly.

Alternatives considered:

- Inline base64 screenshots into logs: rejected because it bloats logs and increases accidental sensitive-data exposure.
- Keep no evidence log: rejected because future automation needs an audit trail for target selection and verification.

## Risks / Trade-offs

- Screenshot capture can expose sensitive visible content -> Use narrow scopes, explicit capture requests, and metadata-only logs.
- Active-window identity can become stale after a snapshot -> Include enough metadata for future current-window verification and treat snapshots as point-in-time evidence.
- Tool availability differs by host -> Detect capture backends and fail with clear missing-tool messages instead of installing dependencies.
- Hyprland JSON fields can change across versions -> Normalize only fields needed by the contract and preserve raw payload paths only for debugging if needed.
- Region capture may require interactive user selection -> Mark region capture as unavailable in non-interactive contexts unless a region is provided.

## Migration Plan

This is a new capability. No existing behavior needs migration.

Implementation can be rolled back by removing the new `hypr-computer-use` visibility tools and related documentation/spec artifacts. Because the first slice is read-only, rollback should not need data repair.

## Open Questions

- Which screenshot backend should be the first implementation target on the user's current Hyprland setup: portal, grim/slurp, hyprshot, or the existing screenshot helper exposed to agents?
- Should evidence files live under a plugin-local cache directory, a session temp directory, or OpenCode's project/session storage if available?
- Should full-desktop capture be enabled by default, or require an explicit high-scope opt-in policy?
