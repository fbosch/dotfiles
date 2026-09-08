## Why

Pi's startup view does not show whether the workspace, integrations, or auth chain are ready for work. The information exists across Pi runtime state and local extensions, but users must discover it through separate commands or after an operation fails.

## What Changes

- Replace Pi's built-in startup header with a compact session header while preserving the resource list, transcript, editor, and prompt footer.
- Show workspace identity, passive Neovim, direnv, and evidence-based LSP status.
- List bounded formatter and language-server candidates that could apply, without scanning, executing, or claiming executable availability.
- Show the effective repository auth chain, provider windows, reset and expiry deadlines, and explicit legacy-cache limitations.
- Show a frozen base initial-context estimate, including configured auto-compact reserve and free capacity.
- Show resolved extension and skill totals and coverage-qualified extension updates next to extensions.
- Show startup duration from the installed `@liborw/pi-startup-time` package, using its module-load-to-`session_start` measurement semantics.
- Implement the header and its publishers as extensions. Missing optional extension publishers omit their output without preventing the rest of the header from rendering.
- Add only the minimum sanitized, read-only Pi runtime capability needed for facts unavailable through public extension APIs.
- Keep collection passive. The header does not fetch, refresh credentials, start services, run tools, poll, or create a model turn.

## Capabilities

### New Capabilities

- `pi-startup-session-header`: Defines the extension-first startup header's data contract, optional publisher behavior, rendering, lifecycle, degraded states, and minimal runtime integration.

### Modified Capabilities

- None.

## Impact

- Affected dotfiles: a new extension under `.pi/agent/extensions/`, shared structured status exports from auth, Neovim, direnv, LSP, and formatter extensions, `pi-context-view` integration, passive consumption of the installed `@liborw/pi-startup-time` measurement, and neighboring tests.
- Affected Pi runtime: only runtime-owned facts that public extension APIs cannot provide may require a typed read-only capability in the pinned Pi package. Any patch remains guarded in `/home/fbb/nixos/modules/development/ai/pi/` and must be reviewed whenever the pinned Pi version changes.
- Affected interfaces: immutable versioned owner snapshots and an optional minimal runtime capability. Header registration does not depend on optional publishers or the runtime capability.
- Existing legacy auth cache remains readable without a persisted schema migration. It reports unavailable metadata rather than being reconstructed or fetched.
- No new dependency is required. The approved prototype remains layout reference only at `references/start-screen-concepts.html`.
