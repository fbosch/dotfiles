## Context

`opencode.nvim` discovers machine-local OpenCode servers by process and overlapping working directory. It submits prompts to the selected server's HTTP API and receives events through its SSE connection. The configured OpenCode start command optionally resumes an OpenCode session inferred from the shared database, but it does not pass a Neovim RPC address or other editor identity.

This works naturally for a Neovim instance in each sibling worktree because their CWDs differ. It does not identify two instances opened in one worktree: either instance can attach to a single discovered server, and multiple same-CWD servers require manual selection. An MCP process associated with a shared server therefore cannot safely infer which editor's live buffers to read.

Neovim already exposes a local Msgpack-RPC socket to child processes through the `NVIM` environment variable. The bridge can use this socket to retrieve live editor state, including unsaved buffer content, without granting OpenCode arbitrary editor evaluation.

## Goals / Non-Goals

**Goals:**

- Bind one MCP bridge process to exactly one Neovim RPC socket for its full lifetime.
- Ensure the bound socket is inherited when Neovim starts an OpenCode server.
- Provide OpenCode with bounded, read-only live editor context without agent-selected instance routing.
- Preserve the normal CWD-based server discovery workflow so sibling worktrees normally select distinct servers.
- Make the target editor and connection failure state observable in diagnostics and MCP results.

**Non-Goals:**

- Changing OpenCode's server-discovery protocol or attaching a Neovim instance ID to arbitrary requests.
- Automatically routing a shared OpenCode server to one of several Neovim instances in the same worktree.
- Exposing arbitrary `nvim_exec_lua`, `nvim_command`, write operations, terminal input, or file-system access through MCP.
- Replacing `opencode.nvim` prompt placeholders or its existing server/session UI.
- Synchronizing unsaved buffer content between Neovim instances.

## Decisions

### One bridge per OpenCode process

The bridge SHALL be launched as an MCP stdio child of the OpenCode server process and SHALL receive the launching Neovim's socket address through an explicit environment variable. It connects only to that address and does not enumerate sockets or use CWD to locate Neovim.

This produces a connection-scoped relationship:

```text
Neovim instance -> OpenCode server -> MCP bridge -> bound Neovim socket
```

The current OpenCode startup command will be adjusted so its child process environment retains the Neovim socket. The MCP configuration will pass that value to the bridge. This is preferable to a shared registry because the server connection itself supplies the required identity and the agent never chooses an instance.

Alternative considered: a machine-wide registry with most-recent-focus selection. Rejected because focus is unrelated to the prompt's origin and can silently leak context from another editor.

Alternative considered: a single shared OpenCode server augmented with a session-to-instance binding. Rejected for the initial change because current prompt requests and later MCP requests do not carry durable Neovim identity; concurrent activity could overwrite a session binding.

### Worktrees provide ordinary server isolation

The bridge does not use a worktree path as its identity. Existing CWD discovery remains the normal way that Neovim instances in sibling worktrees find separate OpenCode servers. The socket binding protects the bridge context even if the user deliberately starts multiple OpenCode servers from one worktree.

Alternative considered: require a generated Neovim instance token in discovery. Deferred because it requires changes to the discovery protocol and adds configuration where unique worktree paths already handle the primary workflow.

### Curated read-only MCP surface

The bridge will implement tools for:

- connection and active-editor context: bound instance metadata, current CWD, active buffer, cursor, mode, and visual selection when present;
- buffer inventory: listed buffers with names, filetypes, modified state, and loaded state;
- visible windows: buffers and visible line ranges;
- bounded buffer reads: named or active buffer ranges from Neovim memory;
- diagnostics: current or named buffer diagnostics with positions and severity.

All responses include connection metadata that identifies the bound socket, Neovim PID where available, and the selected buffer/window. Buffer content reads will require a bounded range or an enforced maximum response size. The bridge will return structured errors for invalid buffers, excessive requests, and disconnection.

Alternative considered: expose a generic RPC proxy. Rejected because it gives the model the ability to mutate the editor, execute Lua, and bypass context and size controls.

### Fail closed on lifecycle changes

The bridge SHALL validate its socket at startup and before serving dependent requests. When the bound Neovim instance exits or cannot be contacted, it returns a clear unavailable error and never reconnects to another socket. OpenCode may continue without live editor context, but it cannot obtain context from a different instance.

Alternative considered: fall back to `$NVIM` at request time. Rejected because the environment remains the original child-process environment and any fallback discovery would make target selection ambiguous.

### Minimal Neovim integration

The initial implementation will rely on Neovim's built-in Msgpack-RPC API. A small Lua helper is acceptable only for launch-environment wiring or for a snapshot that cannot be safely expressed with public RPC methods. The bridge remains outside Neovim so it is usable by OpenCode's MCP lifecycle and independently testable.

## Risks / Trade-offs

- [A Neovim instance attaches to an already-running OpenCode server started by another instance] -> The bridge correctly remains bound to the original instance, but its context is not the attaching client's context. Document that same-worktree multi-instance use needs a dedicated selected server until request-level identity exists.
- [The `NVIM` environment is absent for a non-terminal launch path] -> Require an explicit socket variable, validate it before bridge startup, and report configuration failure rather than using discovery.
- [A buffer is large or contains sensitive unsaved content] -> Enforce line/byte limits, make content reads explicit tools, and keep all tools read-only.
- [Neovim's active UI state changes during a tool call] -> Return a point-in-time snapshot with buffer/window identifiers and do not promise atomic multi-call state.
- [The socket path is accessible to another local process] -> Do not expose it to the model as an input, do not accept arbitrary socket overrides, and retain local-user filesystem permissions as the transport boundary.
- [OpenCode configuration is global while the bridge is per server] -> Pass the inherited socket only in the per-process environment so concurrent bridge children remain isolated.

## Migration Plan

1. Add the bridge implementation and test it against a standalone Neovim RPC socket.
2. Update the Neovim OpenCode startup path to pass the launching socket explicitly and configure the MCP child to consume it.
3. Add connection health output showing server identity, bridge availability, and the bound Neovim instance.
4. Validate two Neovim instances in sibling worktrees, then validate that disconnecting one bridge does not expose the other instance.
5. Roll back by removing the MCP bridge entry and socket environment from the OpenCode startup path; existing `opencode.nvim` prompts and placeholders continue to work.

## Open Questions

- Which local runtime and MCP SDK best fits the existing OpenCode plugin/tooling layout?
- Does the installed OpenCode version pass configured MCP child environments unchanged, or does the command need a small wrapper that validates and forwards the socket?
- What default line and byte limits preserve useful source context without creating excessive token use?
- Should `nvim_get_context` include selected text directly when small, or only report the selection and require `nvim_read_buffer` for content?
