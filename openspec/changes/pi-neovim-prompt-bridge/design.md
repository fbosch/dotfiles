## Context

See `proposal.md` for motivation and the two capability specs for observable
behavior. The current Pi extension is a Msgpack-RPC client of the fixed
`PI_NVIM_SOCKET`; it installs passive Neovim notifications and owns their
cleanup through one Effect scope. Neovim owns one Snacks terminal and persists
the exact Pi session ID for restoration. Herdr owns panes and workspaces and Pi
already has one lifecycle reporter.

Pi 0.84.4 publicly exposes `sendUserMessage`, `ExtensionContext.isIdle`, and TUI
editor get/set methods. `sendUserMessage` returns `void` and always starts a
turn. It requires an explicit delivery mode while streaming. The bridge must
therefore distinguish literal idle submission from editor append and cannot
promise provider completion in its acknowledgement.

## Goals / Non-Goals

**Goals:**

- Add one explicit Neovim-to-Pi request path to the existing channel.
- Keep request delivery tied to the exact terminal launch, sessions, channel,
  editor process, and worktree.
- Make cancellation, busy state, duplicate delivery, timeout, focus, and
  cleanup deterministic.
- Restore OpenCode prompt ownership until each Pi interaction proves parity.
- Stage literal Ask before context, append, actions, and mapping cutover.

**Non-Goals:**

- No second socket, Pi process, session owner, or Herdr reporter.
- No terminal keystroke injection, arbitrary editor command, private Pi API, or
  Pi TUI patch.
- No implicit streaming queue, steer behavior, prompt-triggered session
  selection, or automatic retry after uncertain delivery.
- No Pi implementation of editable diff review or clickable patch navigation.

## Decisions

### Use a versioned notification and request acknowledgement

Neovim sends `pi:nvim-prompt/v1` with `rpcnotify` to the one channel bound by the
Pi terminal. A synchronous `rpcrequest` is rejected because Pi must call back
into Neovim to acknowledge and could otherwise re-enter a blocked RPC handler.

Pi validates and dispatches the request, then calls the fixed `prompt_ack`
bridge operation with `nvim_exec_lua`. The Lua bridge validates the callback's
RPC channel and resolves only the pending request whose request, launch, and
session identity match. This uses the current channel in both directions and
requires no unrelated transport.

### Add a launch correlation ID

Neovim generates a 32-character lowercase hexadecimal `PI_NVIM_LAUNCH_ID` for
each terminal process and records it with terminal ownership. Pi returns it
when binding its actual session ID. Session IDs and worktrees alone cannot
distinguish a stale Pi process from a newly owned launch after reload or
replacement.

The launch ID is not a secret or an authentication claim. It prevents
accidental stale-process routing inside the same trusted Neovim process.

### Keep literal submit separate from append

`submit` calls:

```ts
pi.sendUserMessage(text, { expandPromptTemplates: false });
```

It is accepted only when the current context is TUI, has UI, reports idle, and
has no blocking UI prompt. No `deliverAs` value is used while idle. Streaming
and blocked requests fail instead of choosing follow-up or steer behavior.

`append` reads and synchronously writes the Pi TUI editor text. The request
contains the exact separator, so whitespace has no protocol meaning. It never
calls `sendUserMessage`.

Alternatives rejected:

- terminal input injection is focus-sensitive and untestable
- a second Pi RPC process would split session and restoration ownership
- `setEditorText` cannot represent submit
- `sendUserMessage` cannot represent append because it always starts a turn

### Use at-most-once request sequencing

Neovim numbers requests from 1 for each terminal launch and derives
`requestId` from launch ID plus sequence. Rebinding the same launch, replacing
the Pi session, or reloading the extension does not reset that sequence. Pi
reserves the ID and a normalized payload fingerprint before any side effect. A
process-global replay ledger preserves the launch sequence across extension
reloads and retains at most 64 in-flight or completed outcomes; evicted older
sequences remain stale because the expected sequence is retained.

Identical completed duplicates replay the prior acknowledgement. In-flight
duplicates, ID reuse with changed content, old unknown sequences, and sequence
gaps fail without dispatch. Neovim never retries after acknowledgement timeout
because the public `sendUserMessage` call has no completion result; a timeout
cannot prove whether a turn started.

### Preserve focus during cold startup

The terminal owner gains an internal preserve-focus startup option used only by
prompt requests. It can show the Pi split but configures the Snacks window not
to enter it and restores the captured source window defensively. Normal
`:PiStart`, toggle, and focus behavior stays unchanged.

The pending request is sent by the existing channel/session binding event, not
by polling. Only a matching accepted acknowledgement focuses the Pi terminal.
Rejection, timeout, disconnect, and cancellation retain or restore source
focus.

### Keep request validation separate from tool response parsing

A dedicated prompt protocol module owns closed envelope validation, UTF-8 byte
limits, stable failure codes, sequencing, and acknowledgements. Default prompt
context is a closed selection reference: canonical file path, buffer ID,
`changedtick`, selection mode and policy, and anchor/cursor positions. It carries
no source text and does not grow with the selected range. Nested keys and
worktree containment are validated before dispatch.

Positions use one-based lines and UTF-8 byte columns plus native virtual-cell
offsets. Keeping anchor/cursor direction and the `selection` option avoids
losing reversed, exclusive, or block selection semantics. Lua captures this
reference before opening input and rechecks path and `changedtick` before
launch and delivery.

Pi receives only `filepath:line-range: user prompt`, with byte columns included
for character selections. Do not append JSON, context blocks, read instructions,
or hidden model messages. The structured reference stays in the bridge for
validation and guarded reads.

The existing `read_buffer` operation accepts a worktree-relative or absolute
path, resolves the loaded source buffer internally, and applies the current Ask
reference's identity and changedtick guards. The model need not discover buffer
IDs or guess ticks. Explicit guards remain available for deliberate later reads.
References may cover more than the per-read 500-line limit.

Lua captures eligible context before input and rechecks the buffer path and
changed tick immediately before `rpcnotify`. Generic literal Ask permits null
context. Known placeholders fail when their required snapshot is unavailable;
unknown placeholders remain literal.

### Derive readiness from public Pi state

The extension stores only the current session context and small protocol state.
It checks `ctx.isIdle()` at dispatch and tracks blocking prompt events to fail
closed. Session start/replacement establishes context; session shutdown and the
existing Effect finalizer clear listeners, pending UI state, timers, and
bindings. The bounded replay ledger remains for the terminal launch so reload
cannot admit an already-dispatched request. No readiness polling is introduced.

### Keep context rendering bounded and explicit

Context placeholders are added after literal Ask. `@this` lands first, followed
by buffer, diagnostic, quickfix, visible-window, and listed-buffer context.
Selection text is delimited as untrusted data, and `expandPromptTemplates:
false` prevents slash command or prompt template dispatch. These controls do
not eliminate model prompt injection from source text, so normal Pi permission
and tool controls remain authoritative.

## Risks / Trade-offs

- [An acknowledgement can follow a successful dispatch whose provider later
  fails] -> Define acceptance as synchronous public API invocation only and
  leave later failures in Pi's normal TUI and lifecycle reporting. A synchronous
  public API exception is `PI_DELIVERY_UNKNOWN`, not a safe rejection.
- [An acknowledgement can be lost after a turn starts] -> Report unknown
  delivery, retire prompt ingress for that launch, and require the user to
  inspect Pi and restart its terminal before another submission.
- [A Pi process launched before launch IDs cannot bind] -> Reject it with an
  actionable launch mismatch and require one terminal restart.
- [Another trusted Neovim plugin can forge a request] -> State the same-process
  trust boundary explicitly. Launch identity prevents stale routing but is not
  authentication; local Neovim plugins and same-user RPC clients are trusted.
  Keep operations closed and incapable of arbitrary editor or terminal
  execution.
- [Source text can contain model instructions] -> Delimit it as untrusted data,
  disable Pi prompt expansion, and retain normal permissions.
- [Preserve-focus startup differs from the current launcher] -> Isolate it as an
  option and add cold-start headless coverage before exposing `:PiAsk`.
- [Append can preserve undesirable existing input] -> Require explicit append
  semantics; add replace only as a separate future operation.
- [Context and action parity can expand scope] -> Ship literal Ask first and
  require one acceptance gate per placeholder, append mapping, and picker.

## Migration Plan

1. Restore OpenCode ownership for `<leader>ac`, `ga`, and `<A-x>`, add an
   explicit OpenCode Ask command, and keep Pi focus/toggle unchanged.
2. Prove idle literal submit and TUI append with Pi 0.84.4 public APIs. Stop
   without patching Pi if the proof fails.
3. Add protocol contracts, launch binding, preserve-focus start,
   acknowledgements, lifecycle cleanup, and unmapped literal `:PiAsk`.
4. Add stable `@this`, then editor append and the prior `ga`/`<A-x>` workflows.
5. Add the remaining bounded placeholders and Pi action picker.
6. Move default prompt mappings only after the complete automated and live
   matrix passes.

Before mapping cutover, rollback removes the canary command and protocol
handler. After cutover, rollback restores the prompt mappings to OpenCode
without changing Pi editor tools, restoration metadata, or Herdr integration.
OpenCode removal requires a separate approved change after a Pi upgrade and a
repeated rollback matrix.
