# Neovim MCP

`neovim-context.ts` gives OpenCode live context and tightly bounded presentation access to the Neovim instance that started its server.

## Binding

Neovim starts OpenCode with `OPENCODE_NVIM_SOCKET` set to its RPC socket. OpenCode starts the MCP child with that value as `NVIM_CONTEXT_SOCKET`. The bridge connects only to that socket for its lifetime.

The bridge never discovers another Neovim instance. If its bound editor exits, context tools return an unavailable error.

Sibling worktrees normally produce separate OpenCode server processes because their CWDs differ. Two Neovim instances in one worktree need separate selected OpenCode servers for their live context to remain correct.

## Tools

- `context`: active buffer, cursor, mode, and selection metadata.
- `nvim_focus_context`: the most recently focused normal source buffer before focus entered OpenCode.
- `nvim_selection`: bounded exact text from the active source visual selection.
- `visible_windows`: visible windows and source buffers beside OpenCode.
- `nvim_list_buffers`: listed buffers and source-buffer subset.
- `nvim_read_buffer`: bounded in-memory source reads, including unsaved content.
- `nvim_diagnostic_summary`: severity counts and a bounded diagnostic prefix for the active or selected buffer.
- `nvim_diagnostics`: current diagnostics for the active or selected buffer.
- `nvim_quickfix`: bounded current quickfix or location-list entries.
- `nvim_reveal`: reveal an existing source buffer at an exact position, optionally in an explicit split.
- `highlight`: temporarily mark one exact source-buffer range without changing text.
- `clear_highlight`: remove a highlight returned by `highlight` before it expires.
- `annotate`: temporarily attach one concise, color-coded LSP-lines-style callout to a source line.

`nvim_read_buffer` and `nvim_selection` allow at most 500 lines or 32 KiB per call. The bridge does not expose arbitrary Neovim evaluation, commands, edits, terminal input, or socket selection.

`nvim_quickfix` returns 20 items by default, at most 50 items, and no more than 32 KiB of discovery data.

Presentation tools use loaded source buffers or readable workspace-relative paths. `nvim_reveal` never steals focus unless `focus: true` is explicit and creates a split only when `split` is `horizontal` or `vertical`. `nvim_highlight` needs `startLine` plus exactly one of `buffer` or `path` to mark a whole live line; exact columns remain optional. A path is loaded or reused, then shown in a source window without focus stealing. Highlights use a bridge-owned extmark namespace, expire after 2 seconds by default, and are capped at 30 seconds and 500 lines.

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
