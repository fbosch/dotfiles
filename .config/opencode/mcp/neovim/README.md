# Neovim MCP

`neovim-context.ts` gives OpenCode read-only access to the Neovim instance that started its server.

## Binding

Neovim starts OpenCode with `OPENCODE_NVIM_SOCKET` set to its RPC socket. OpenCode starts the MCP child with that value as `NVIM_CONTEXT_SOCKET`. The bridge connects only to that socket for its lifetime.

The bridge never discovers another Neovim instance. If its bound editor exits, context tools return an unavailable error.

Sibling worktrees normally produce separate OpenCode server processes because their CWDs differ. Two Neovim instances in one worktree need separate selected OpenCode servers for their live context to remain correct.

## Tools

- `nvim_context`: active buffer, cursor, mode, and selection metadata.
- `nvim_visible_windows`: visible windows and source buffers beside OpenCode.
- `nvim_list_buffers`: listed buffers and source-buffer subset.
- `nvim_read_buffer`: bounded in-memory source reads, including unsaved content.
- `nvim_diagnostics`: current diagnostics for the active or selected buffer.

`nvim_read_buffer` allows at most 500 lines or 32 KiB per call. The bridge does not expose arbitrary Neovim evaluation, commands, edits, terminal input, or socket selection.

## Validation

Run the MCP tests and quality checks from `.config/opencode`:

```sh
pnpm --dir mcp test
pnpm run quality:fallow:mcp
pnpm run quality:fallow:mcp:audit
```
