## Context

See `proposal.md` for motivation. The current editor integration is split across Neovim, OpenCode, and Herdr:

- Neovim owns buffers, diagnostics, presentation state, its RPC socket, and editor session restoration.
- OpenCode owns the current AI session, TUI, edit review, and a socket-bound Neovim MCP bridge.
- Herdr owns workspaces, tabs, panes, and restoration of the labeled Neovim process.

Pi already has disk-backed LSP tools, handoff and transcript recovery, file-change bookkeeping, and Herdr title and lifecycle reporting. These remain separate from the live editor bridge. The existing OpenCode bridge and its tests provide proven contracts for bounded Neovim snapshots, wrong-instance isolation, and presentation cleanup.

## Goals / Non-Goals

**Goals:**

- Bind an editor-aware Pi process to exactly one launching Neovim instance.
- Port live context and presentation behavior without broadening editor authority.
- Preserve Neovim-first session ownership and exact worktree-scoped Pi resume.
- Reuse current Pi Herdr reporting instead of adding competing lifecycle state.
- Switch individual workflows only after end-to-end evidence exists.

**Non-Goals:**

- Replacing Pi's existing LSP, handoff, or file-change integrations.
- Converting OpenCode conversation history into Pi sessions.
- Sharing one live editor connection across worktrees or Pi processes.
- Exposing a general Neovim RPC proxy, arbitrary Lua, Ex commands, key input, terminal input, or text mutation through context tools.
- Rebuilding diff review or clickable TUI navigation through private Pi APIs.
- Removing unrelated OpenCode commands, plugins, sessions, or configuration.

## Decisions

### Use a Pi-native fixed-socket bridge

Neovim will launch Pi with its RPC socket in a Pi-specific inherited environment variable. The Pi extension will capture that value at startup and will not accept socket paths through tool arguments, prompts, configuration selected by the model, or runtime discovery.

The extension will verify the editor's working directory and source paths against the Pi project worktree before returning content or performing presentation actions. A disconnected socket remains unavailable for that Pi process; it is never replaced through discovery.

Alternative considered: register the existing OpenCode bridge as a shared MCP server. Rejected because Pi can host a focused extension directly, a shared server would add lifecycle and approval layers, and the OpenCode process-specific environment is not the Pi ownership boundary.

Alternative considered: discover the most recently focused Neovim instance. Rejected because focus does not prove prompt origin and can expose another worktree's unsaved content.

### Adapt the proven snapshot core, not the OpenCode adapter

The fixed Lua snapshots, validators, limits, and bridge tests under `.config/opencode/mcp/neovim/` are the safest starting point. Pi-specific tool registration and error conversion will live under `.pi/agent/extensions/`; OpenCode MCP registration and tool names will not be imported.

Shared code will be extracted only when both hosts still consume the same implementation and doing so reduces duplication without coupling their lifecycle. Copying a small stable core is preferable to a new host-neutral package with one active consumer.

Alternative considered: modify the OpenCode MCP implementation in place to serve both hosts. Rejected because it risks the rollback path and entangles two different host APIs.

### Keep live Neovim state distinct from Pi LSP state

The editor bridge reports Neovim's in-memory buffers, diagnostic namespaces, windows, selections, quickfix lists, and location lists. `.pi/agent/extensions/lsp/` continues to report independent language-server evidence for project files. Tool descriptions and results will name their source so the model does not merge these states implicitly.

Alternative considered: feed unsaved buffers into Pi's LSP extension and expose one diagnostic tool. Rejected because it changes the LSP extension's disk-backed contract and hides which diagnostic system produced a result.

### Use a curated operation set with stable errors

The extension will register explicit operations for context, focus context, selection, buffer inventory, bounded reads, diagnostics, problem lists, reveal, highlight cleanup, and annotations. Each boundary validates inputs before invoking fixed bridge-owned Lua.

Errors will contain a stable code and human-readable message. Expected codes include unavailable editor, worktree mismatch, invalid buffer, invalid range, limit exceeded, stale anchor, and unsupported operation. Socket paths and unsaved source content must not be written to logs or lifecycle metadata.

Alternative considered: expose generic `nvim_exec_lua` with prompt instructions. Rejected because instructions cannot enforce least authority or prevent data and text mutation.

### Keep presentation operations separate from source mutation

Reveal, highlight, and annotation operations may change windows, cursor position, or bridge-owned extmarks only according to explicit arguments. They cannot alter buffer text. Annotation batches validate every anchor before creating any extmark, and all bridge-owned presentation state is removable on session shutdown.

Alternative considered: encode annotations as buffer text or virtual documents. Rejected because cleanup and rejection would no longer preserve source state.

### Store Pi session identity beside OpenCode metadata

Neovim session metadata will gain separate Pi fields for the exact Pi session identifier and terminal-open state. OpenCode fields remain untouched during coexistence. Restoration uses only the stored exact Pi identity after validating project and worktree association; it never falls back to the latest Pi session.

Herdr continues to restore the labeled Neovim pane. Neovim's existing session-load event then decides whether to launch or resume Pi. A missing Pi session reports an error but does not block Neovim restoration or rewrite metadata.

Alternative considered: let Herdr restore Pi directly. Rejected because this creates two restoration owners and can launch Pi before Neovim has restored its editor state and socket.

### Reuse the existing Pi Herdr reporters

The editor launcher will pass only the pane identity needed by the existing Pi Herdr extensions. Those extensions remain responsible for title and working, idle, blocked, error, and shutdown state. The Neovim bridge will not emit a second agent state stream.

Alternative considered: port the OpenCode Neovim integration's Herdr reporter. Rejected because Pi already reports these states and duplicate sources would race.

### Treat diff review and clickable navigation as capability gates

Editor-owned diff review requires supported APIs that preserve source contents on reject and cancellation and write the reviewed result on accept. Clickable patch navigation requires a supported public Pi rendering or click API. Each capability gets a bounded proof before implementation. If the API is absent, the capability remains OpenCode-owned and does not block unrelated Pi editor workflows.

Private renderer patching is excluded because it would make upgrades and failure diagnosis depend on undocumented Pi internals.

### Cut over by verified workflow

Pi starts as an opt-in Neovim action beside OpenCode. Each workflow moves independently after automated tests and a live tracer bullet pass. A capability matrix records `Pi`, `OpenCode retained`, or `retired` and links the evidence. Pi becomes the default only after every required workflow is resolved and the explicit OpenCode rollback path has been exercised.

## Risks / Trade-offs

- [The inherited socket points to the wrong or stale editor] → Validate connection identity and worktree on startup and every dependent request; never discover a replacement.
- [Unsaved buffers expose more source than disk-based tools] → Require explicit bounded reads, enforce 500-line and 32 KiB limits, and avoid logging content.
- [Editor state changes between calls] → Return point-in-time buffer and window identities; do not promise cross-call atomicity.
- [Neovim and Pi disagree about worktree identity] → Fail with a structured mismatch instead of normalizing or falling back silently.
- [A missing Pi session breaks workspace restoration] → Restore Neovim independently, report the Pi failure, and do not substitute another session.
- [Presentation state survives a failed Pi process] → Use bridge-owned namespaces, bounded expiry, and cleanup during the next connection or explicit clear operation.
- [Two Herdr reporters race] → Keep lifecycle ownership in the existing Pi extensions and test that only one source is registered.
- [Pi lacks stable diff or click APIs] → Retain those workflows in OpenCode and record the limit rather than patching private internals.
- [Copying bridge logic creates drift] → Port only the tested snapshot core, document its source, and add equivalent Pi regression coverage before changing behavior.

## Migration Plan

1. Add an opt-in Pi launcher and the minimal fixed-socket context, focus, selection, and status operations.
2. Add visible and listed buffers, unsaved reads, and Neovim diagnostics while keeping Pi LSP unchanged.
3. Persist exact Pi session metadata and validate Neovim-first Herdr restoration.
4. Add quickfix, location-list, reveal, highlight, cleanup, and annotation operations.
5. Validate embedded Pi through the existing Herdr lifecycle reporters.
6. Evaluate and, only when supported, implement editor-owned diff review and clickable patch navigation.
7. Record capability evidence, switch verified Neovim actions to Pi, and retain explicit OpenCode rollback until the agreed retention window ends.

Rollback at every step disables only the Pi Neovim launcher or extension. It does not remove OpenCode configuration, sessions, or existing Pi integrations.
