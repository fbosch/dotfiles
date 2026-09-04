## Why

Pi cannot observe or control the live Neovim instance that launched it. It can inspect files through its own LSP integration, but unsaved buffers, visual selections, Neovim diagnostics, quickfix state, source presentation, and Neovim-owned session restoration remain OpenCode-only workflows.

## What Changes

- Add a Pi extension bound to the exact Neovim RPC socket inherited from its launcher through one persistent bidirectional Msgpack-RPC channel.
- Expose bounded tools for live editor context, unsaved buffers, Neovim diagnostics, quickfix and location lists, source reveal, temporary highlights, and annotations.
- Accept bounded, allowlisted Neovim notifications for editor focus, session metadata, and lifecycle changes without allowing notifications to trigger model turns automatically.
- Persist an exact Pi session identifier in Neovim session metadata so Herdr restores Neovim before Neovim resumes Pi.
- Connect embedded Pi sessions to the existing Herdr title and lifecycle reporters without introducing a second ownership path.
- Add opt-in Pi launch and editor actions beside the existing OpenCode workflow, then switch defaults only after each required workflow passes an independent live check.
- Evaluate editor-owned diff review and clickable patch navigation against public Pi APIs. Retain those workflows in OpenCode when Pi cannot support their required contracts without private renderer changes.

## Capabilities

### New Capabilities

- `pi-neovim-editor-bridge`: Binds Pi to one launching Neovim instance over a bidirectional channel and provides constrained live context, editor events, inspection, navigation, and presentation tools.
- `pi-neovim-session-restoration`: Persists and resumes the exact worktree-scoped Pi session through Neovim-first Herdr restoration.
- `pi-neovim-workflow-cutover`: Governs coexistence, lifecycle reporting, capability gates, verification, rollback, and the eventual default switch from OpenCode to Pi.

### Modified Capabilities

None.

## Impact

- Pi extensions and configuration under `.pi/agent/`.
- Neovim agent integration, session metadata, keymaps, and tests under `.config/nvim/`.
- Existing Pi Herdr lifecycle integration and Herdr-managed Neovim restoration.
- Migration records under `docs/agents/plans/`.
- Tested logic may be adapted from `.config/opencode/mcp/neovim/` and `.config/opencode/plugins/neovim-integration/`; the OpenCode implementation remains available during migration.
- No new runtime dependency is assumed. Any proposed Pi IDE package or TUI integration requires a separate public-API and dependency decision before adoption.
