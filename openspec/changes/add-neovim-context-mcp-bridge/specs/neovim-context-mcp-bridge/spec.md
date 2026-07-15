## ADDED Requirements

### Requirement: Connection-scoped Neovim binding
The system SHALL start each Neovim-context MCP bridge with an explicit RPC socket address for the Neovim instance that started its owning OpenCode server. The bridge SHALL bind to that socket for its entire lifetime and MUST NOT select a Neovim instance by CWD, worktree, process discovery, desktop focus, or agent-supplied identifier.

#### Scenario: Bridge receives the launching Neovim socket
- **WHEN** Neovim starts an OpenCode server with the context bridge configured
- **THEN** the bridge connects only to the RPC socket supplied by that server's launch environment

#### Scenario: Sibling worktrees use separate editor context
- **WHEN** Neovim instances in sibling worktrees start separate OpenCode servers
- **THEN** each server's bridge returns context only from the Neovim socket that launched that server

### Requirement: Read-only live editor context
The bridge SHALL expose read-only MCP tools for active editor context, listed buffers, visible windows, bounded in-memory buffer reads, and diagnostics. The tools SHALL read current Neovim memory so unsaved buffer content and state are available where applicable.

#### Scenario: Agent requests active editor context
- **WHEN** OpenCode calls the active-context tool
- **THEN** the bridge returns the bound instance metadata, current working directory, active buffer, cursor position, editor mode, and selection metadata when present

#### Scenario: Agent reads unsaved buffer content
- **WHEN** OpenCode calls a bounded buffer-read tool for a modified loaded buffer
- **THEN** the bridge returns the requested in-memory lines rather than reading the file from disk

#### Scenario: Agent requests diagnostics
- **WHEN** OpenCode calls the diagnostics tool for the active or named buffer
- **THEN** the bridge returns current diagnostic messages with positions and severities from the bound Neovim instance

### Requirement: Bounded and curated access
The bridge MUST enforce documented limits on buffer read ranges and response size. It MUST NOT expose arbitrary Neovim RPC evaluation, Lua execution, Ex commands, key input, buffer mutation, terminal interaction, or caller-provided socket selection.

#### Scenario: Request exceeds content limit
- **WHEN** OpenCode requests more buffer content than the configured line or byte limit
- **THEN** the bridge returns a structured limit error that states how the request can be narrowed

#### Scenario: Agent attempts unsupported editor execution
- **WHEN** OpenCode attempts to invoke an operation outside the bridge's read-only tools
- **THEN** the bridge does not execute the requested editor operation

### Requirement: Fail-closed lifecycle behavior
The bridge SHALL validate the bound socket before serving context. If the bound Neovim instance is unavailable, the bridge SHALL return a structured unavailable error and MUST NOT reconnect to, discover, or return context from another Neovim instance.

#### Scenario: Bound Neovim exits
- **WHEN** the Neovim instance associated with a bridge exits
- **THEN** a subsequent context tool call reports that the bound instance is unavailable

#### Scenario: Another Neovim remains active
- **WHEN** the bound Neovim instance is unavailable and another Neovim instance is running
- **THEN** the bridge does not return context from the other instance

### Requirement: Observable target identity
Every successful context result SHALL identify the bound Neovim instance and the buffer or window from which the result was derived. The Neovim OpenCode health output SHALL report the bridge binding state separately from the OpenCode server connection state.

#### Scenario: Context result identifies its source
- **WHEN** the bridge returns live editor context
- **THEN** the result includes bound-instance metadata and the selected buffer or window identity

#### Scenario: Health reports unavailable bridge
- **WHEN** the OpenCode server remains connected but the bridge cannot reach its bound Neovim instance
- **THEN** the health output distinguishes the connected server from the unavailable bridge
