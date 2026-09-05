## Why

Neovim can provide bounded editor context to Pi, but it cannot explicitly
submit or append prompt text through a supported interface. The current Pi
mappings therefore replaced OpenCode Ask and append interactions with focus-only
behavior and overstated the completed migration.

## What Changes

- Add a versioned, bounded prompt-request protocol to the existing bound
  Neovim Msgpack-RPC channel.
- Add a literal idle-only `:PiAsk` canary that uses `vim.ui.input` and Pi's
  public `sendUserMessage` API without terminal input injection.
- Bind each request to the exact terminal launch, Pi session, Neovim session,
  RPC channel, and canonical worktree.
- Add acknowledgements, duplicate protection, busy rejection, preserve-focus
  startup, and lifecycle cleanup.
- Restore OpenCode Ask and append mappings while Pi prompt workflows remain
  canaries.
- Stage bounded context placeholders, Pi editor append, action selection, and
  default mapping cutover behind independent validation gates.
- Preserve OpenCode for unsupported editable diff and clickable navigation
  workflows and as the explicit prompt rollback.

## Capabilities

### New Capabilities

- `pi-neovim-prompt-bridge`: Explicit, bounded prompt submission and editor
  append requests over the existing Pi-Neovim channel.
- `pi-neovim-prompt-workflows`: Neovim Ask, context, append, action selection,
  rollout, and rollback behavior.

### Modified Capabilities

None.

## Impact

The change affects `.pi/agent/extensions/neovim/`, the Pi Neovim Lua modules,
Neovim commands and mappings, neighboring Bun and headless Neovim tests, and
the existing migration record. It adds no dependency, socket, Pi process,
Herdr lifecycle reporter, or private Pi API.
