## Why

Pi's startup view does not show whether the workspace, integrations, or auth chain are ready for work. The information exists across Pi runtime state and local extensions, but users must discover it through separate commands or after an operation fails.

## What Changes

- Replace Pi's built-in startup header with a compact session header while preserving the resource list, transcript, editor, and prompt footer.
- Show workspace identity, passive Neovim, direnv, and evidence-based LSP status.
- List bounded formatter and language-server candidates that could apply, without scanning, executing, or claiming executable availability.
- Show the effective repository auth chain, provider windows, reset and expiry deadlines, and explicit legacy-cache limitations.
- Show a frozen base initial-context estimate, including configured auto-compact reserve and free capacity.
- Show resolved extension and skill totals, coverage-qualified extension updates next to extensions, and completed startup duration.
- Add a sanitized, read-only Pi runtime startup snapshot interface with a capability handshake, schema-version check, generation and revision ordering, and nonfatal fallback to Pi's built-in header.
- Keep collection passive. The header does not fetch, refresh credentials, start services, run tools, poll, or create a model turn.

## Capabilities

### New Capabilities

- `pi-startup-session-header`: Defines the startup header's data contract, rendering, lifecycle, degraded states, passive integration requirements, and capability fallback.

### Modified Capabilities

- None.

## Impact

- Affected dotfiles: a new extension under `.pi/agent/extensions/`, shared structured status exports from auth, Neovim, direnv, LSP, and formatter extensions, `pi-context-view` integration, and neighboring tests.
- Affected Pi runtime: the pinned Pi package needs a typed read-only startup snapshot API. The integration must be maintained with the existing Pi patches in `/home/fbb/nixos/modules/development/ai/pi/` and reviewed whenever the pinned Pi version changes.
- Affected interfaces: immutable versioned snapshots and session-scoped owner events. The runtime patch and aligned declarations deploy before the header is enabled.
- Existing legacy auth cache remains readable without a persisted schema migration. It reports unavailable metadata rather than being reconstructed or fetched.
- No new dependency is required. The approved prototype remains layout reference only at `references/start-screen-concepts.html`.
