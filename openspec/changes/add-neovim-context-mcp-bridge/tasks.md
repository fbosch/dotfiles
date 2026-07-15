## 1. Bound Active-Context Bridge

- [ ] 1.1 Choose the local bridge runtime, MCP SDK, entrypoint, and test command after inspecting the existing OpenCode MCP configuration.
- [ ] 1.2 Implement a bridge that requires an explicit Neovim socket at startup, connects only to that socket, and exposes a read-only active-context tool with instance metadata, CWD, active buffer, cursor, mode, and selection metadata.
- [ ] 1.3 Wire the launching Neovim socket through the OpenCode server process to its MCP child and add bridge binding status to `:OpencodeHealth`.
- [ ] 1.4 Add automated and manual verification that a configured OpenCode instance retrieves active context from its launching Neovim instance.
- [ ] 1.5 Add unavailable-socket and closed-Neovim tests proving the bridge returns a structured error and never discovers or falls back to another active Neovim instance.

## 2. Live Unsaved Source Context

- [ ] 2.1 Extend the bridge with a read-only buffer-inventory tool that identifies listed buffers, filetypes, loaded state, and modified state.
- [ ] 2.2 Add a bounded buffer-read tool that retrieves an active or explicitly identified buffer range from Neovim memory and returns source metadata with the result.
- [ ] 2.3 Enforce and document line and byte response limits; reject invalid buffers, ranges, and oversized reads with actionable structured errors.
- [ ] 2.4 Verify end to end that an OpenCode MCP call reads unsaved content from the bound Neovim buffer rather than its on-disk file.
- [ ] 2.5 Verify the exposed MCP surface has no generic RPC proxy, evaluation, mutation, terminal-input, or socket-selection operation.

## 3. Current Workspace and Diagnostic Context

- [ ] 3.1 Add a visible-windows tool that reports each visible buffer and its visible line range from the bound Neovim instance.
- [ ] 3.2 Add a diagnostics tool for the active or identified buffer that returns current message, source, severity, and position data.
- [ ] 3.3 Ensure visible-window and diagnostic results identify the bound instance and their source window or buffer.
- [ ] 3.4 Verify end to end that the tools report the active editor view and diagnostics after the editor state changes, including unsaved modifications.

## 4. Multi-Worktree Operational Readiness

- [ ] 4.1 Validate two Neovim instances in sibling worktrees with separate OpenCode servers and prove each bridge returns only its originating instance's active context, source reads, visible windows, and diagnostics.
- [ ] 4.2 Document the connection model, including worktree CWD isolation, immutable socket binding, and the same-worktree requirement to use a dedicated selected server for correct live context.
- [ ] 4.3 Run the bridge test suite, the relevant Neovim Lua formatter or linter, and `:checkhealth opencode` after configuration changes.
