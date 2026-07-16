# Neovim MCP

`neovim-context.ts` gives OpenCode read-only access to the Neovim instance that started its server.

## Binding

Neovim starts OpenCode with `OPENCODE_NVIM_SOCKET` set to its RPC socket. OpenCode starts the MCP child with that value as `NVIM_CONTEXT_SOCKET`. The bridge connects only to that socket for its lifetime.

The bridge never discovers another Neovim instance. If its bound editor exits, context tools return an unavailable error.

Sibling worktrees normally produce separate OpenCode server processes because their CWDs differ. Two Neovim instances in one worktree need separate selected OpenCode servers for their live context to remain correct.

## Tools

- `nvim_context`: active buffer, cursor, mode, and selection metadata.
- `nvim_focus_context`: the most recently focused normal source buffer before focus entered OpenCode.
- `nvim_selection`: bounded exact text from the active source visual selection.
- `nvim_visible_windows`: visible windows and source buffers beside OpenCode.
- `nvim_list_buffers`: listed buffers and source-buffer subset.
- `nvim_read_buffer`: bounded in-memory source reads, including unsaved content.
- `nvim_diagnostic_summary`: severity counts and a bounded diagnostic prefix for the active or selected buffer.
- `nvim_diagnostics`: current diagnostics for the active or selected buffer.
- `nvim_lsp_hover`: live LSP hover information at the active cursor or an explicit source position.
- `nvim_document_symbols`: bounded live LSP file structure from the active or selected buffer.
- `nvim_lsp_status`: bounded attached-LSP client status for the active or selected buffer.
- `nvim_quickfix`: bounded current quickfix or location-list entries.

`nvim_read_buffer` and `nvim_selection` allow at most 500 lines or 32 KiB per call. The bridge does not expose arbitrary Neovim evaluation, commands, edits, terminal input, or socket selection.

`nvim_document_symbols`, `nvim_lsp_status`, and `nvim_quickfix` return 20 items by default, at most 50 items, and no more than 32 KiB of discovery data.

## Validation

Run the MCP tests and quality checks from `.config/opencode/mcp/neovim`:

```sh
pnpm test
pnpm run quality:fallow
pnpm run quality:fallow:audit
```

## Benchmark

Run the baseline benchmark from `.config/opencode/mcp/neovim`:

```sh
pnpm run benchmark
```
