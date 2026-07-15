## Why

OpenCode can receive explicit editor context from `opencode.nvim`, but it cannot retrieve live Neovim state while acting autonomously. The current CWD-based OpenCode server discovery can also attach several Neovim instances in one repository to the same server, so an MCP tool must not guess which editor to read.

## What Changes

- Add a read-only MCP bridge that retrieves live state from the Neovim instance bound to its owning OpenCode server process.
- Pass the launching Neovim RPC socket to each OpenCode server started from Neovim and configure that server's bridge with the socket.
- Expose bounded tools for active context, buffers, visible windows, diagnostics, and in-memory buffer ranges, including unsaved changes.
- Make the bridge fail when its bound Neovim instance is unavailable; it MUST NOT discover or route to another instance.
- Preserve the existing worktree-oriented CWD discovery workflow for normally isolating OpenCode servers between sibling worktrees.

## Capabilities

### New Capabilities

- `neovim-context-mcp-bridge`: Provides OpenCode MCP tools with safe, read-only live context from the Neovim instance bound to the server connection.

### Modified Capabilities

- None.

## Impact

- Neovim OpenCode plugin configuration and server launch environment.
- New local MCP bridge executable or plugin component using Neovim Msgpack-RPC.
- OpenCode MCP configuration and process environment handling.
- Validation for multiple Neovim instances in sibling worktrees and for a disconnected bound instance.
