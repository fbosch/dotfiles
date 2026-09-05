# Pi Neovim Prompt Bridge

## Status

In progress. Prompt ownership is corrected, the Pi 0.84.4 public API proof is
complete, and the literal unmapped `:PiAsk` canary is implemented with automated
round-trip coverage. Its isolated live matrix remains pending. This slice does
not reopen the completed editor inspection and presentation work.

## Problem

The first Pi Neovim migration replaced `<leader>ac`, `ga`, and `<A-x>` with
operations that record editor context and focus Pi. Those mappings do not
preserve the OpenCode workflows they replaced:

- `<leader>ac` opened a Snacks input, submitted one prompt, then focused the
  OpenCode terminal.
- `ga` appended `@this` to OpenCode without submitting it.
- Visual `<A-x>` appended the selected source text. Normal `<A-x>` appended
  references to visible buffers.

The installed `opencode.nvim` revision, `2ddeebd3212596b51bf078e6ff52862655b80419`,
also provides context placeholders, input completion and highlighting, a
prompt/action picker, operator ranges, session commands, event forwarding, and
edit review. Pi already has stronger bounded editor inspection, session
restoration, and Herdr lifecycle integration, but Neovim has no supported way
to place a user prompt into that Pi session.

The existing bridge deliberately treats Neovim notifications as passive state.
They cannot submit prompts or start model turns. Prompt delivery needs a
separate protocol for explicit Neovim user actions.

## Outcome

Provide a public-API-only Neovim-to-Pi prompt path with these final workflows:

- `<leader>ac` captures source context, opens `vim.ui.input`, submits once to
  the owned idle Pi session, then focuses Pi.
- `ga` appends the captured `@this` context to Pi's editor without starting a
  turn.
- Visual `<A-x>` appends the exact bounded selection without starting a turn.
- Normal `<A-x>` appends bounded identities for visible source buffers without
  starting a turn.
- `<leader>as` opens a Snacks-enhanced Pi action picker after the required
  prompt presets have migrated.
- `<C-\>` and `<A-a>` continue to focus and toggle Pi without prompt delivery.

`vim.ui.input` is the required input interface. The existing Snacks input
provider may enhance it, but the bridge must still work with Neovim's fallback.

The first shipped slice is literal idle-only `:PiAsk`. Context placeholders,
append operations, the action picker, and default-key cutover follow as separate
vertical slices. The bridge adds no dependency; Snacks is already present and
remains an optional enhancement over `vim.ui`.

## Decisions

### Use Pi's public extension APIs

The Pi extension receives validated requests and uses only public Pi 0.84.4
interfaces:

- `pi.sendUserMessage(text, { expandPromptTemplates = false })` for an explicit
  submit. This starts one model turn.
- `ctx.ui.getEditorText()` and `ctx.ui.setEditorText(text)` for append or
  prefill. These do not start a model turn.

Do not inject terminal input, feed keys, call private TUI objects, patch Pi, or
start Pi in RPC mode beside the existing terminal session.

### Keep passive notifications passive

`pi:focus`, lifecycle notifications, and session metadata continue to update
state only. They cannot be promoted into prompt requests by adding fields.

Prompt requests use a separate versioned notification method and can originate
only from `:PiAsk`, a Pi prompt mapping, or a Pi action selected by the user in
Neovim. Model output, autocmds, focus changes, buffer changes, restoration, and
Herdr events cannot create prompt requests.

### Reuse the existing channel and ownership model

Neovim remains the Msgpack-RPC server and Pi remains its client. The prompt
bridge reuses the one channel opened from `PI_NVIM_SOCKET`; it does not add
socket discovery, another listener, or another Pi process.

Each Pi terminal launch also receives an opaque `PI_NVIM_LAUNCH_ID` generated
by Neovim. The value is a correlation ID, not a secret. Pi returns it when
binding its actual session ID. Neovim accepts the binding only when all of these
match the active terminal:

- launch ID
- Pi session ID
- Neovim session owner
- canonical worktree
- RPC channel

This closes the stale-process gap that worktree and session ID checks alone do
not cover. Socket paths, launch IDs, channel IDs, and session IDs never come
from prompt text or model-selected input.

### Submit once and do not guess after a timeout

A submitted Snacks input maps to one request ID and at most one call to
`pi.sendUserMessage`. Pi remembers a bounded set of completed request IDs and
the expected sequence for the terminal launch, including across extension
reloads.

- An identical duplicate receives the recorded acknowledgement and produces no
  second side effect.
- Reusing an ID with different content is rejected.
- Neovim does not retry a submit after an acknowledgement timeout. The UI
  reports that delivery is unknown and requires the user to inspect Pi before
  trying again.

This favors at-most-once behavior over convenience. Retrying an ambiguous
submission can start two model turns.

### Reject implicit streaming behavior

The first slice accepts submit only while Pi is idle. Streaming, blocked,
starting, replacing a session, or unknown state returns `PI_BUSY` or
`PI_SESSION_NOT_READY` without calling `sendUserMessage`.

A later explicit follow-up operation may use `deliverAs: "followUp"`. The bridge
does not infer follow-up or steer behavior from Pi state, trailing whitespace,
or timing. `steer` is outside this plan until it has its own interaction and
cancellation contract.

### Capture context before opening input

`PiAsk` captures an immutable, bounded source snapshot before `vim.ui.input`
changes mode or focus. Cancellation discards it. The initial submit slice sends
literal text and records the snapshot identity; later context slices render
only placeholders present in the prompt.

Source text is untrusted data. Rendered context is delimited from the user's
instruction, byte-bounded, and never interpreted as a command or prompt
template.

## User interface contract

### Commands

- `:PiAsk [prefill]` opens an input with the optional literal prefill. After
  context support is available, an omitted prefill defaults to `@this:` followed
  by one space. The initial literal canary defaults to empty input.
- `:PiAppend` appends explicit text or rendered context to Pi's editor and does
  not submit.
- `:PiBridgeHealth` reports protocol version, connection state, launch binding,
  session binding, Pi state, and the last failure code. It never displays
  prompt text, source text, socket paths, or session-file paths.

Canary commands are additive. Default mappings stay with the verified owner
until the matching Pi command passes its live gate.

### Ask lifecycle

1. Capture source context when the current buffer is eligible. Generic literal
   Ask remains available with a null snapshot.
2. Record the source buffer, cursor, visual range, modified state, worktree,
   Neovim session owner, and terminal launch generation when available.
3. Open `vim.ui.input` without starting or focusing Pi.
4. On cancellation, restore the visual selection when applicable and stop.
5. Reject a known context placeholder when its required snapshot is absent.
6. Reject empty, whitespace-only, invalid UTF-8, NUL-containing, or oversized
   text before launching Pi.
7. Reuse the owned terminal or start one through a new preserve-focus launcher
   mode. It may create and show the Pi split but must keep the captured source
   window current.
8. Wait for the event-driven launch and session binding handshake.
9. Deliver one request to that channel.
10. Focus Pi only after an accepted acknowledgement.
11. On rejection or timeout, keep or restore editor focus and show the stable
    failure code with an actionable message.

Cancellation starts no terminal, sends no request, changes no session metadata,
and triggers no model turn.

### Append lifecycle

Append reads Pi's current editor text and writes the exact concatenation through
`ctx.ui`. The caller supplies separators explicitly. The protocol gives trailing
spaces no hidden meaning.

Append is rejected when Pi has no TUI, the session is not bound, or the editor
text cannot be read. Append never calls `sendUserMessage` and never starts a
turn. An accepted append focuses Pi after acknowledgement so the user can
continue editing or submit there. A later action may offer replace as a distinct
operation; append must not silently overwrite existing Pi input.

## Protocol contract

### Transport

Neovim sends this asynchronous Msgpack-RPC notification to one bound Pi
channel:

```text
pi:nvim-prompt/v1
```

The request direction must use `rpcnotify`, never `rpcrequest`. Pi can then send
the acknowledgement as a normal request without re-entering a synchronous
Neovim callback.

The sole argument is a closed request object:

```text
{
  version: 1,
  requestId: string,
  sequence: positive integer,
  operation: "submit" | "append",
  launchId: string,
  sessionId: string,
  ownerId: string,
  cwd: string,
  editorPid: positive integer,
  text: string,
  context: ContextSnapshot | null
}
```

Unknown fields, versions, and operations are rejected. `launchId` is 32
lowercase hexadecimal characters, `requestId` is
`nvim:<launchId>:<sequence>` and at most 96 ASCII bytes, and `sessionId` keeps
its existing restricted grammar with a new 128-byte maximum. `cwd` must
canonicalize to the Pi extension's `ctx.cwd` and the bound editor worktree.
Neovim starts `sequence` at 1 for each terminal launch and increments it once
per request. Rebinding the same launch, replacing the Pi session, or reloading
the extension does not reset it. IDs are never derived from prompt content.

The Pi client returns the acknowledgement with a normal `nvim_exec_lua`
request for the fixed `prompt_ack` bridge operation on the same channel. The
bridge dispatcher adds the RPC channel ID, validates it against the pending
request's launch binding, and invokes the Neovim prompt module's acknowledgement
handler:

```text
{
  version: 1,
  requestId: string,
  launchId: string,
  sessionId: string,
  ownerId: string,
  outcome: "accepted" | "rejected" | "duplicate",
  state: "starting" | "idle" | "streaming" | "blocked" | "closed",
  code?: FailureCode
}
```

The Neovim handler resolves only the pending request with the exact request ID,
launch ID, session ID, and channel. Unknown, late, or mismatched
acknowledgements have no focus or UI side effect. A round-trip test must cover
`rpcnotify` from Neovim, Pi dispatch, `prompt_ack`, pending-request resolution,
and post-ack focus.

Acknowledgements contain no prompt or source text. `accepted` means only that
Pi synchronously validated the request and invoked the public
`pi.sendUserMessage` or `ctx.ui.setEditorText` call without an exception. The
public `sendUserMessage` API returns `void`; the acknowledgement cannot promise
that an `input` handler, model provider, or resulting turn will succeed. Later
failures remain visible through Pi's normal TUI and lifecycle events and do not
retract the acknowledgement.

### Bounds

- Raw prompt: at most 16 KiB of valid UTF-8.
- Captured selection: existing limit of 500 lines and 32 KiB.
- Rendered context: at most 32 KiB.
- Complete request: at most 64 KiB.
- One pending request per Neovim-owned Pi terminal.
- Reserve the request ID, sequence, and a bounded payload digest before calling
  any Pi API. An identical duplicate while dispatch is in flight returns
  `PI_REQUEST_PENDING` and produces no second side effect. A completed
  identical duplicate replays the recorded acknowledgement. Reusing an ID with
  different content returns `PI_REQUEST_ID_REUSED`.
- The last 64 request outcomes and the expected sequence are retained in memory
  per launch across extension reloads. An unknown lower sequence is stale; a
  gap is out of order and is rejected without advancing the expected sequence.
- Cold-start request deadline: 10 seconds, cancelled immediately on terminal
  close, session replacement, worktree change, or channel disconnect.

Reject rather than truncate. Preserve newlines, tabs, `æ`, `ø`, `å`, emoji, and
other valid UTF-8 exactly.

### Context snapshot

The snapshot extends the existing `ActiveContext` wire shape with a bounded
`snapshotId`, source `changedtick`, and `modifiable` state:

```text
{
  snapshotId: string,
  pid: positive integer,
  cwd: canonical path,
  mode: string,
  buffer: {
    number: positive integer,
    name: canonical worktree-contained path,
    loaded: true,
    filetype: string,
    buftype: "",
    modified: boolean,
    modifiable: true,
    changedtick: non-negative integer
  },
  cursor: { line: positive integer, column: positive integer },
  selection?: {
    mode: "v" | "V" | control-v,
    anchor: Position,
    cursor: Position,
    lines: string[]
  }
}
```

Add a closed `parsePromptContext` request validator. It first rejects extra
outer, buffer, position, and selection keys. It validates `snapshotId`,
`modifiable`, and `changedtick`, delegates the shared editor fields to
`parseActiveContext`, and then requires the parsed PID and canonical worktree
to equal the bound `EditorIdentity`. It also requires an empty `buftype`, a
loaded source buffer, and the existing selection byte and line limits.

Immediately before `rpcnotify`, Lua rechecks that the buffer number is valid,
still names the same canonical path, and has the captured `changedtick`. A
mismatch returns `PI_CONTEXT_STALE`. Paths outside the worktree, special or
terminal buffers, and over-limit selections fail closed.

### Context syntax

Port the useful `opencode.nvim` placeholders incrementally:

1. `@this`: captured selection when present, otherwise the captured file and
   cursor location.
2. `@buffer`: captured buffer identity and an instruction to use the existing
   `neovim` tool for bounded unsaved text.
3. `@diagnostics`: bounded Neovim diagnostics for the captured buffer.
4. `@quickfix`: bounded global quickfix entries.
5. `@visible`: bounded identities for source buffers visible in the current
   tab.
6. `@buffers`: bounded listed source-buffer identities.

Do not port `@marks` until current use is demonstrated. Unknown placeholders
remain literal. When a known placeholder is present but unavailable or too
large, reject before submission rather than silently omit it.

Snacks input may highlight and complete known placeholders. Completion is an
interface aid only; protocol behavior does not depend on Snacks.

## Stable failures

- `PI_BRIDGE_UNAVAILABLE`
- `PI_PROTOCOL_MISMATCH`
- `PI_INVALID_REQUEST`
- `PI_PROMPT_EMPTY`
- `PI_PROMPT_TOO_LARGE`
- `PI_INVALID_UTF8`
- `PI_CONTEXT_UNAVAILABLE`
- `PI_CONTEXT_STALE`
- `PI_CONTEXT_TOO_LARGE`
- `PI_TERMINAL_OWNED`
- `PI_SESSION_NOT_READY`
- `PI_SESSION_MISMATCH`
- `PI_WORKTREE_MISMATCH`
- `PI_LAUNCH_MISMATCH`
- `PI_BUSY`
- `PI_NO_UI`
- `PI_REQUEST_PENDING`
- `PI_REQUEST_ID_REUSED`
- `PI_STALE_REQUEST`
- `PI_REQUEST_OUT_OF_ORDER`
- `PI_ACK_TIMEOUT`
- `PI_DISCONNECTED`
- `PI_DELIVERY_UNKNOWN`
- `PI_UNSUPPORTED`

Malformed notifications without a valid request ID are ignored. A valid request
ID receives a rejection when the channel is still usable.

## Ownership and lifecycle

- Neovim owns the input UI, source snapshot, terminal instance, pending request,
  focus, and launch ID.
- Pi owns its prompt editor, model turns, streaming state, session ID, and
  session file.
- The extension owns request validation, dispatch, duplicate detection, and
  acknowledgements.
- Herdr owns panes and workspaces. The prompt bridge uses the existing Pi Herdr
  reporter and does not report lifecycle state independently.

The extension derives request availability from public Pi events:
`session_start`, `agent_start`, `agent_settled`, `ui_prompt_start`,
`ui_prompt_end`, and `session_shutdown`. No readiness polling is added.

`session_shutdown` removes the notification listener, invalidates the launch
and session binding, rejects pending requests, clears prompt request IDs, and
releases the existing channel through the current Effect scope. Reload, resume,
fork, and new-session replacement cannot reuse old request state or a stale
`ExtensionContext`.

## Security model

The Unix socket and same-user Neovim process are the trust boundary. The launch
ID prevents accidental stale-process routing but is not authentication against
another plugin running inside that Neovim process. Delimiting source context
reduces instruction/data ambiguity but does not eliminate prompt injection from
source text; Pi's normal permission and tool controls remain authoritative.

Controls:

- fixed inherited socket, no discovery or caller-selected endpoint
- exact launch, channel, Pi session, Neovim session, and canonical worktree
  checks before dispatch
- closed protocol objects and operation allowlist
- UTF-8 and byte validation at both Lua and TypeScript boundaries
- `expandPromptTemplates: false`
- no command, key, terminal, Lua, Ex, file-write, or arbitrary tool operation
- no prompt, context, socket, or session-file content in logs, health output,
  Herdr state, or acknowledgements
- no automatic retry after ambiguous submission

A malicious Neovim plugin already shares the editor process and can call local
Lua directly. This bridge does not claim to isolate trusted Neovim plugins from
one another.

## Feature selection from `opencode.nvim`

Port:

- Ask input with cancellation, highlight, completion, and provider-owned input
  history where available
- explicit prompt submit
- explicit prompt append
- context placeholders used by current mappings
- action and prompt picker
- operator-based range capture if it improves on visual selection mappings
- health and user-visible delivery failures

Use Pi-native behavior instead of porting:

- Pi session selection and model commands
- Pi lifecycle and status events
- permission questions
- tool execution and file changes

Retain in OpenCode:

- editable diff review
- per-hunk accept and reject
- clickable patch navigation
- any OpenCode session needed for rollback

Do not port:

- OpenCode server discovery, database lookup, REST API, or SSE protocol
- implicit trailing-space and trailing-ellipsis control syntax
- OpenCode session commands
- `@marks` without usage evidence

## Delivery plan

### Phase 0: Correct the predecessor record and specify the change

- Create a separate OpenSpec change named `pi-neovim-prompt-bridge` with the
  protocol, user-visible behavior, failure codes, and safety invariants from
  this plan.
- Mark generic Ask input and prompt submission as `OpenCode retained` in the
  original Pi Neovim migration matrix.
- Restore `<leader>ac`, `ga`, and `<A-x>` to their actual OpenCode Ask and append
  behavior while the Pi bridge is a canary. Keep Pi focus on `<C-\\>` and Pi
  toggle on `<A-a>`.
- Add explicit Pi canary commands without taking default keys.

Acceptance:

- OpenCode Ask opens through Snacks and submits independently.
- OpenCode append mappings preserve their prior behavior.
- Existing Pi focus and editor-inspection workflows remain unchanged.
- `openspec validate pi-neovim-prompt-bridge --strict` passes before
  implementation starts.

### Phase 1: Prove public Pi ingress

Build an isolated extension tracer that exercises `sendUserMessage`,
`getEditorText`, and `setEditorText` from an explicit simulated Neovim request.
Verify idle, streaming, blocked, shutdown, and replacement-session behavior in
Pi 0.84.4.

Acceptance:

- One idle submit produces one `input` event with source `extension` and one
  turn.
- Submit uses `expandPromptTemplates: false`; leading slash commands and source
  text cannot dispatch an extension command or prompt template.
- Append requires `ctx.mode === "tui"` and `ctx.hasUI`, changes editor text,
  and produces no input event or turn.
- Busy requests fail without hidden queueing.
- No private Pi module is imported.

If this proof fails, retain OpenCode Ask and stop. Do not patch Pi.

Proof record (2026-09-05):

- `prompt-dispatch.test.ts` passes seven focused cases for one idle literal
  dispatch, busy and blocked rejection, missing-TUI rejection, exact append,
  and zero append submissions.
- The implementation imports `ExtensionAPI` and `ExtensionContext` only from
  Pi's public package root. It calls `sendUserMessage` once with
  `expandPromptTemplates: false` and gives append no access to that API.
- Pi 0.84.4's public declaration says `sendUserMessage` always triggers a turn;
  the installed runtime routes that call to `prompt` with `source:
"extension"`. Provider completion is deliberately outside the bridge
  acknowledgement contract.
- `bun run typecheck` passes after the proof.

### Phase 2: Ship literal `:PiAsk` canary

Implement the versioned request, launch binding, session/worktree checks,
acknowledgement, duplicate defense, cold-start queue, and cancellation cleanup.
Expose `:PiAsk` without assigning a default key.

Acceptance:

- Empty and cancelled input have no side effects.
- Idle warm and cold Pi sessions each receive one literal prompt.
- Wrong launch, session, socket, and worktree fail closed.
- Busy Pi rejects the request.
- Focus changes only after acceptance.
- Timeout creates no automatic retry.

Implementation record (2026-09-05):

- `:PiAsk [prefill]` is available without a default mapping. It validates input
  before launch and uses a preserve-focus terminal start.
- Launch, Pi session, Neovim owner, editor PID, channel, and canonical worktree
  identity are bound before delivery. Pre-launch Pi processes remain usable for
  editor inspection but cannot accept prompt requests until restarted.
- The focused Pi and Herdr extension suite passes 103 tests with 473 assertions,
  including a real headless Neovim notification and `prompt_ack` round trip.
- The prompt, launcher, exact-session restoration, production restoration,
  cutover, and OpenCode restoration Neovim tasks pass.
- The isolated warm/cold two-worktree live matrix remains the Phase 2 exit gate.

### Phase 3: Add stable `@this` context

Capture context before opening input. Render `@this` for cursor, character,
line, and block selections. Add Snacks highlighting and completion with the
native `vim.ui.input` fallback intact.

Acceptance:

- The request uses the pre-input snapshot even after the input window changes
  focus.
- Unsaved and multibyte selections arrive byte-for-byte within the bounds.
- Reversed, stale, missing, and oversized selections fail deterministically.
- Cancellation restores the visual selection and clears temporary highlights.

### Phase 4: Add append and current context mappings

Implement exact editor append through `ctx.ui`, then port `ga` and both `<A-x>`
modes one at a time.

Acceptance:

- Each append modifies Pi's editor exactly once, starts no turn, and focuses Pi
  only after acknowledgement.
- Visual `<A-x>` preserves bounded unsaved source text.
- Normal `<A-x>` includes each visible source buffer once and excludes special,
  terminal, duplicate, and sibling-worktree buffers.
- Existing nonempty Pi input is preserved exactly.

### Phase 5: Port remaining context and actions

Add `@buffer`, `@diagnostics`, `@quickfix`, `@visible`, and `@buffers` with
individual bounds and tests. Add `:PiActions` using `vim.ui.select` with Snacks
picker enhancement. Port only prompt presets that still have a user.

Acceptance:

- Every picker item declares whether it submits or appends before selection.
- Context expansion is deterministic and cannot trigger commands.
- Unknown or unavailable placeholders are visible failures, not omissions.
- OpenCode-only session, diff, and navigation items do not appear as fake Pi
  actions.

### Phase 6: Cut over default prompt mappings

Run the full prompt matrix, then assign `<leader>ac`, `ga`, `<A-x>`, and
optionally `<leader>as` to their verified Pi operations. Keep
`:OpenCodeStart`, `:OpenCodeToggle`, an explicit OpenCode Ask command, and
`<leader>aO` available.

Acceptance:

- The default mappings preserve their documented interaction, not just source
  context or terminal focus.
- OpenCode Ask still works after every Pi check.
- No key is owned by both native package activation paths.
- The original capability matrix links to this plan and its evidence.

## Automated validation

Add neighboring tests under the existing Neovim and Pi extension test trees.
Cover:

- closed request and acknowledgement schemas
- launch/session/worktree/channel binding
- passive notification prohibition
- idle submit calls `sendUserMessage` exactly once
- busy submit calls it zero times
- append calls only `getEditorText` and `setEditorText`
- in-flight and completed duplicates, ID reuse, stale request, disconnect, and
  timeout behavior
- UTF-8 byte boundaries, including `æ`, `ø`, `å`, and emoji
- cancellation and empty input
- stable pre-input cursor and visual snapshots
- char, line, block, reversed, stale, and oversized selection context
- visible buffers, diagnostics, and quickfix bounds
- Snacks-enhanced and native input/select fallbacks
- headless cold start through the preserve-focus launcher mode, restored
  session, accepted-ack focus timing, and terminal close
- no `nvim_chan_send`, `feedkeys`, terminal input, private Pi import, or second
  socket path
- unchanged OpenCode metadata, restoration, and rollback entry points
- one existing Herdr reporter for submitted and blocked states

Run the focused tasks first, then:

```sh
./scripts/lua-quality.sh neovim
cd .pi/agent && bun run typecheck
cd .pi/agent && bun test extensions/neovim extensions/herdr
just stow-check
devenv tasks run test:stow
devenv test
ripsecrets <changed prompt-bridge paths>
git diff --check
openspec validate pi-neovim-prompt-bridge --strict
```

Repository-wide baseline failures unrelated to the bridge must be recorded, not
silenced or folded into bridge code.

## Live matrix

Use isolated Pi session directories and two Neovim sockets in sibling
worktrees. Record request IDs and failure codes, never prompt or source text.

Verify:

- warm idle submit
- cold start and exact session binding
- exact restored Pi session
- input cancellation before launch
- empty and oversized prompt rejection
- normal, character, line, and block `@this`
- unsaved selection with multibyte text
- literal unknown placeholder
- append into empty and nonempty Pi editor text
- streaming and blocked rejection
- terminal close while waiting for binding
- session replacement while waiting for acknowledgement
- stale launch ID and stale session ID, including a Pi process launched before
  `PI_NVIM_LAUNCH_ID` existed
- wrong socket and sibling-worktree isolation
- lost acknowledgement with no automatic resubmit
- Herdr working and blocked state through the existing reporter
- OpenCode Ask, toggle, restoration, and edit review after Pi validation

## Rollback and removal

Before Phase 6, rollback removes the canary commands and protocol handlers.
OpenCode mappings remain the default.

After Phase 6, rollback restores `<leader>ac`, `ga`, `<A-x>`, and `<leader>as`
to OpenCode without changing Pi editor inspection, session metadata, or Herdr
integration.

OpenCode prompt wiring can be removed only in a separate approved cleanup after:

- every migrated prompt workflow passes again after at least one Pi upgrade
- the explicit OpenCode rollback is exercised after that run
- diff review and clickable navigation have independent owners
- no persisted OpenCode session is still needed

## Success criteria

- `<leader>ac` opens a Snacks-enhanced input and starts exactly one turn in the
  exact owned Pi session after explicit submission.
- `ga` and `<A-x>` append editor context without starting a turn.
- Cancel, busy, stale, disconnected, wrong-session, and wrong-worktree paths
  fail without prompt delivery.
- Passive editor notifications still cannot trigger work.
- The bridge uses one inherited Neovim socket, one Pi terminal, one Pi session,
  and one Herdr reporter.
- No private Pi API or terminal input injection is present.
- OpenCode remains an exercised rollback for prompt and unsupported review
  workflows.
