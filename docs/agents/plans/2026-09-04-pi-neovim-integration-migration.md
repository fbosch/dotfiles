# Pi–Neovim Integration Migration

## Purpose

Replace the Neovim workflows that still require OpenCode with verified Pi
integrations. Migrate one usable workflow at a time and keep OpenCode available
until its replacement passes an independent live check.

## Constraints

Apply these rules throughout the migration:

- Neovim owns editor state and session restoration.
- Herdr restores Neovim before Neovim resumes Pi.
- Pi receives one fixed socket from the Neovim process that launched it.
- Use a Pi-specific environment variable such as `PI_NVIM_SOCKET`. Do not reuse
  `OPENCODE_NVIM_SOCKET`.
- Tools cannot accept arbitrary socket paths or execute caller-supplied Lua.
- Read and presentation results remain bounded.
- Paths must remain inside the bound worktree.
- Read, highlight, and annotation tools cannot modify buffer text.
- Keep OpenCode available until each replacement passes an independent live
  check.
- Do not change Pi's existing LSP, handoff, or Herdr contracts unless a
  demonstrated integration gap requires it.

## Phase 1: Bind Pi to the launching Neovim instance

### Outcome

A Pi session launched from Neovim can identify the correct editor, worktree,
active buffer, cursor, and visual selection.

### Delivery

- Add an opt-in Pi launcher beside the existing OpenCode launcher.
- Pass `vim.v.servername` through `PI_NVIM_SOCKET`.
- Register a focused Pi extension with:
  - `context`, including last-source fallback and bounded selection
  - `status`
- Validate the socket against the launching process and current worktree.
- Fail closed when the socket is missing, stale, or belongs to another
  worktree.

### Non-goals

- Buffer reads
- Diagnostics
- Navigation
- Edits
- Session restoration
- Replacing existing OpenCode keymaps

### Automated checks

- Missing and stale sockets fail clearly.
- No tool accepts a socket argument.
- The TypeScript bridge invokes one fixed dispatcher; `plugins.ai.pi.bridge` handles only allowlisted operation messages.
- Selection output respects line and byte limits.
- Requests from sibling worktrees are rejected.
- Starting Pi outside Neovim leaves the bridge unavailable without breaking Pi.

### Tracer bullet

1. Open the dotfiles repository in Neovim.
2. Select unsaved text.
3. Launch Pi through the new opt-in command.
4. Ask Pi for the current context and verify one call returns the source file,
   cursor, mode, and selected text.
5. Launch another Neovim instance in a sibling worktree.
6. Verify that the first Pi session cannot read the second editor.

### Exit criterion

One Pi session consistently reads only the Neovim instance that launched it.
OpenCode remains the default editor agent.

### Verification record

- `bunx biome check extensions/neovim`, `bun test extensions/neovim`, and
  `bun run typecheck` pass (21 focused tests, 58 assertions).
- `devenv tasks run test:nvim-pi-launcher` passes. The headless fixture confirms
  `PI_NVIM_SOCKET` receives `vim.v.servername`, marks the Pi terminal, preserves
  bounded pre-Pi selection, and supports terminal reuse and reopen-after-close.
- A dedicated headless-Neovim tracer confirmed that a marked Pi terminal is
  replaced by the last bounded source snapshot before context is returned; no
  Pi-terminal marker or metadata reaches the model. The same tracer
  covers an older in-memory launcher snapshot without a top-level mode.
- A live two-worktree tracer connected one channel to each of
  `/Users/fbb/dotfiles` and `/Users/fbb/test-pi-neovim-tracer`. Each channel
  reported its own PID, cwd, buffer, and focus notifications; cross-bound
  sockets returned `NVIM_UNAVAILABLE` with a worktree mismatch.
- `openspec validate pi-neovim-editor-integration --strict` passes.

## Phase 2: Read live buffers and Neovim diagnostics

**Depends on:** Phase 1

### Outcome

Pi can inspect what the user currently sees in Neovim, including unsaved text
and Neovim-native diagnostics.

### Delivery

Add bounded tools for:

- `visible_windows`
- `list_buffers`
- `read_buffer`
- `diagnostic_summary`
- `diagnostics`

Adapt the tested contracts from:

- `.config/opencode/mcp/neovim/neovim-context.ts`
- `.config/opencode/mcp/neovim/neovim-bridge.ts`

Keep `.pi/agent/extensions/lsp/` unchanged. The integrations have separate
responsibilities:

- Neovim bridge: live editor state
- Pi LSP: project files and independent language-server queries

### Automated checks

- Reads return unsaved buffer contents.
- Reads are limited to 500 lines and 32 KiB.
- Only named, editable source buffers are exposed.
- Paths outside the bound worktree are rejected.
- Diagnostics are ordered and bounded.
- Invalid buffers and ranges produce structured failures.
- Reading editor state does not alter disk or buffer contents.

### Tracer bullet

1. Open two files in separate Neovim windows.
2. Modify one without saving.
3. Trigger a diagnostic in that unsaved buffer.
4. Ask Pi to list visible buffers.
5. Ask Pi to read the unsaved text and summarize the current Neovim
   diagnostics.
6. Verify that disk contents remain unchanged.

### Exit criterion

Pi can reason about live unsaved code without confusing Neovim diagnostics with
its independent LSP state.

### Verification record

- A live isolated Neovim tracer opened `one.lua` and `two.lua` in two visible
  windows and connected through the production `PiNeovimChannel`.
- Reading `one.lua` returned its three unsaved in-memory lines with
  `modified: true`, while its disk contents remained
  `local disk = true\nreturn disk\n`.
- Neovim returned one unsaved-buffer error from `pi-live-tracer` with the message
  `unknown_symbol is undefined`; the summary was not truncated.
- The disk SHA-256 remained
  `20150de52489f09a2f088bf1cb70943d05f3871a46ff62fd828e1a8a360567cd`
  before and after the tracer.

## Phase 3: Restore the exact Pi session through Neovim

**Depends on:** Phase 1

### Outcome

Herdr restores Neovim, then Neovim resumes the exact Pi session recorded in its
session metadata.

### Verified Pi 0.84.4 session contract

- The persisted session identifier is the session header's `id`. Extensions read
  the same value through `ctx.sessionManager.getSessionId()`, and RPC
  `get_state` returns it as `sessionId`.
- The session header's absolute `cwd` is Pi's persisted project identity. Pi has
  no separate project or worktree identifier, so restoration must compare this
  path with the restored Neovim worktree.
- Resume with `pi --session <full-session-id>` from the restored worktree. Pass
  the full ID rather than a prefix, and do not use `--continue` or `--resume`.
- Validate an exact current-worktree session before launch. `--session` also
  accepts ID prefixes and offers to fork an ID found only in another project,
  so the CLI lookup alone does not enforce the restoration contract.
- Do not use `--session-id` for restoration. Pi creates a new project session
  with that ID when no exact local session exists.

An isolated Pi 0.84.4 RPC probe confirmed that a version 3 session header stored
one ID and its source `cwd`. `pi --session <full-session-id>` from that directory
returned the same ID and session file. An unknown ID exited with status 1. The
same ID launched from a sibling directory did not resume and offered to fork;
answering no left the sibling unchanged. `--session-id` warned and created a new
empty session when its ID was absent.

### Delivery

- Confirm Pi 0.84.4's supported session ID and resume APIs.
- Add a separate `pi_session_id` field to Neovim session metadata.
- Record whether the Pi terminal was open when Neovim saved its session.
- Resume only an exact session ID associated with the same project and
  worktree.
- Preserve existing `opencode_session_id` metadata for rollback.
- Do not use "latest session" inference.

### Automated checks

Extend Neovim session tests to cover:

- Fresh Pi session capture
- Exact session ID persistence
- Exact resume after `SessionLoadPost`
- Missing or archived session behavior
- Wrong-worktree rejection
- OpenCode metadata remaining unchanged
- Pi not starting when the saved terminal state says it was closed

Keep the existing Herdr restoration tests passing.

### Session metadata implementation record

- Fresh terminals launch plain `pi`, allowing Pi to assign its native session
  ID without the expected missing-ID warning produced by `--session-id`.
- On every Pi `session_start`, the Neovim extension reports Pi's actual session
  ID over the fixed `PI_NVIM_SOCKET`. Neovim binds the ID only to the live Pi
  terminal owned by the current Neovim session, then immediately stores the ID
  and open state. This also tracks Pi session changes made inside the TUI.
- `TermClose` and `BufWipeout` immediately mark the bound terminal closed while
  retaining its exact ID. `SessionSavePre` reconciles the same state, but an
  intervening MiniSessions save is no longer required before `:PiStart` can
  resume a Pi terminal that was just closed.
- Pi metadata updates preserve `opencode_session_id`,
  `opencode_terminal_open`, and other existing Neovim session metadata.
- `devenv tasks run test:nvim-pi-launcher` round-trips both products' fields
  through the JSON metadata file and covers unbound saves, invalid bindings,
  immediate bind/close persistence, terminal reuse, and exact manual resume
  after closing Pi without an intervening MiniSessions save.
- An isolated Pi 0.84.4 RPC tracer launched a fresh session against a temporary
  session directory and headless Neovim socket. Pi emitted no stderr warning,
  and Neovim received the exact session ID returned by Pi's `get_state`.
- `devenv tasks run test:nvim-opencode-session-restore`,
  `just lua-quality changed`, and `just lua-quality style-changed` pass.

### Exact-resume implementation record

- The mini.sessions setup registers Pi persistence before reading a Neovim
  session. Its `SessionLoadPost` handler does nothing unless
  `pi_terminal_open` is true and `pi_session_id` passes Pi 0.84.4's identifier
  rules.
- Resume validation is read-only. Neovim searches the documented default Pi
  directory plus environment- and settings-configured session directories,
  reads only a bounded header, and requires the filename suffix, header ID, and
  absolute canonical header `cwd` to match the restored worktree. It never
  opens a Pi process to validate a session and never selects the latest session.
- A successful resume launches one terminal in the saved worktree with
  `PI_NVIM_SOCKET`, the matched `--session-dir`, and
  `--session <full-session-id>`. Automatic `SessionLoadPost` resume still
  requires `pi_terminal_open`; explicit `:PiStart` resumes the exact retained
  ID even when the terminal was previously closed. Missing, malformed,
  ambiguous, and wrong-worktree sessions produce warnings without silently
  substituting a fresh session or changing Pi, Neovim, or OpenCode metadata.
- `.config/nvim/tests/pi_session_restore.lua` covers exact `SessionLoadPost` and
  manual `:PiStart` resume, idempotent setup, default and configured session
  directories, closed automatic state, missing manual and automatic sessions,
  invalid IDs and headers, relative and sibling-worktree headers,
  active-worktree mismatch, terminal launch failure, unchanged metadata, and
  unchanged Pi JSONL bytes.
- The Pi launcher and restore fixtures are part of `test:all`. The lazy-startup
  fixture now uses `$DEVENV_STATE` on Linux because this Neovim config's
  `wildignore` excludes copied fixtures under `/tmp`.
  Validation:

```sh
devenv tasks run test:nvim-pi-session-restore test:nvim-pi-launcher \
  test:nvim-opencode-session-restore test:nvim-pack-lazy-startup
```

### Production restoration-order record

- `.config/herdr/plugins/neovim-sessions/tests/pi_restore_order.sh` executes the
  production restore script entrypoint against an isolated Herdr workspace,
  pane, process, and metadata fixture. The fake pane enters its restored cwd
  before running the unmodified `HERDR_ENV`, `HERDR_PANE_ID`,
  `HERDR_SOCKET_PATH`, `NVIM_SESSION`, and
  `HERDR_MINI_SESSION_RESTORE` command assembled by `restore.sh`.
- The command launches a real Neovim 0.12 process without `--listen`. The test
  confirms normal startup creates `vim.v.servername`, then loads the production
  session declaration and the pinned `mini.sessions` implementation from its
  installed native package.
- The cross-process order log is exact:

  ```text
  Herdr session report
  → Herdr pane run
  → Neovim startup in the restored cwd
  → Pi handler registration before mini.sessions setup
  → VimEnter
  → Neovim session read and source
  → exact Pi resume
  ```

- The fixture supplies a non-running fake `pi` executable for the availability
  check and stubs only the Snacks terminal process boundary. It verifies the
  full Pi command, exact Neovim and Pi session IDs, worktree cwd, Herdr restore
  metadata, preserved OpenCode fields, and unchanged Pi JSONL bytes without
  starting an interactive Pi process or writing user session state.
- Normal native-package activation remains covered by
  `test:nvim-pack-lazy-startup`, which confirms `mini.sessions` is ready before
  `VimEnter`. The production-order fixture is registered as
  `test:nvim-pi-production-restore` and included in `test:all`.

Validation:

```sh
devenv tasks run test:herdr-neovim-sessions \
  test:nvim-pi-production-restore test:nvim-pi-session-restore \
  test:nvim-pi-launcher test:nvim-opencode-session-restore \
  test:nvim-pack-lazy-startup test:shellcheck
```

### Tracer bullet

1. Start Pi from a Herdr-managed Neovim pane.
2. Exchange enough messages to identify the session.
3. Save and close the workspace.
4. Restore it through Herdr.
5. Verify the order:

   ```text
   Herdr → Neovim → exact Pi session
   ```

6. Repeat with two sibling worktrees.
7. Verify that neither resumes the other worktree's session.

### Live two-worktree restoration record

- On 2026-09-04, an isolated named Herdr server created two sibling Git working
  trees from one disposable repository. It used the production
  `neovim-sessions` plugin and isolated copies of the current Neovim config,
  session metadata, Pi agent directory, cache, and state.
- Each production `:PiStart` launched a real Pi 0.84.4 TUI. A temporary local
  custom provider returned `tracer-response-a` and `tracer-response-b` without
  credentials or network access, giving each session one user message and one
  assistant message. `/session` reported the same exact IDs later stored by
  Neovim:
  - worktree A: `dd55b9c19af3452421354a55d1fe5b66`
  - worktree B: `58490cd787f7d2bf8852c706a67c63b9`
- MiniSessions saved both Neovim sessions while both Pi terminals were open. The
  tracer then terminated only the two disposable Neovim processes, leaving
  their owning shells and `restore_pending` metadata intact, and cleanly
  stopped the named Herdr server so it persisted both workspaces.
- A fresh Herdr server restored both shell panes. The production startup hook's
  metadata recovery relaunched Neovim in each original cwd. Each new Neovim
  process used an automatic RPC socket, emitted `VimEnter` followed by one
  `SessionLoadPost`, and resumed a new Pi process with its original exact ID:
  - worktree A: explicit socket → `/run/user/1000/nvim.38537.0` → original A ID
  - worktree B: explicit socket → `/run/user/1000/nvim.38560.0` → original B ID
- After both restored Pi TUIs repeated `/session`, the tracer closed them and
  substituted B's ID into A's temporary metadata, then A's ID into B's. Both
  calls to `plugins.ai.pi.restore()` returned `false`, opened no terminal, and left
  the original metadata in place.
- The Pi files remained byte-for-byte unchanged across resume and both rejected
  cross-worktree attempts:
  - worktree A SHA-256:
    `e8df3fcf74a9cada85b8df22b9c87499ae3b3377014dbaca6a8fb35d6b462beb`
  - worktree B SHA-256:
    `01b7d286600f477457c61d678fd072998a166e84fb65bbb09c3b882c4ee52eb5`
- The tracer removed the named Herdr session, both working trees, all live
  processes, and all temporary Neovim and Pi state after recording evidence in
  `/tmp/pi-neovim-live-3.5-evidence.json`.

### Exit criterion

Exact Pi continuation works without bypassing Neovim ownership or modifying
OpenCode restoration.

## Phase 4: Add quickfix navigation and source presentation

**Depends on:** Phases 1 and 2

### Outcome

Pi can inspect Neovim problem lists and direct the user to source locations
without modifying text.

### Delivery

Add:

- `quickfix`
- `reveal`
- `highlight`
- `clear_highlight`
- `annotate`

Support both quickfix and location lists. Keep focus and split behavior
explicit.

### Automated checks

- Quickfix results default to 20 and never exceed 50 entries.
- Line, column, split, and focus arguments are validated.
- Reveal rejects paths outside the worktree.
- Highlight duration has a bounded maximum.
- Highlights expire and can be cleared explicitly.
- Annotation batches are atomic and bounded to ten entries.
- Annotation anchors reject stale source text.
- Buffer hashes remain unchanged after every presentation operation.

### Problem-list inspection implementation record

- The `quickfix` operation reads the editor-global quickfix list by default.
  Location-list requests require an explicit owner window from
  `visible_windows`; responses return the owner kind, window when applicable,
  and Neovim list ID.
- Entries preserve Neovim order and expose buffer, filename, validity, type,
  text, and start/end line and column fields. Missing quickfix positions remain
  zero rather than being converted into invented coordinates.
- Results default to 20 entries and accept at most 50. Both the fixed Lua
  producer and TypeScript parser enforce a 32 KiB serialized-result limit.
  Neovim exposes entries only as a complete list snapshot, so the producer
  checks list size first and refuses snapshots above 5,000 entries before
  requesting `items`.
- File entries must remain inside the bound worktree. URI-like filenames,
  special buffers, OpenCode buffers, and Pi terminal buffers are rejected
  without returning partial list content.
- `.pi/agent/extensions/neovim/__tests__/` covers global and location-list
  defaults and maximums, empty lists, explicit ownership, list order, source
  positions, invalid windows, TypeBox bounds, 5,001-entry refusal, serialized
  byte limits, special buffers, and sibling-worktree paths. The focused suite
  passes 51 tests; TypeScript and Biome checks pass.

### Source reveal implementation record

- The `reveal` operation accepts only a loaded source buffer identity plus an
  exact one-based line and byte column. It accepts `none`, `horizontal`, or
  `vertical` split behavior and preserves focus with no split by default. It
  has no path-loading, arbitrary command, input, or Lua surface.
- Fixed bridge Lua resolves the target and worktree through existing ancestors,
  rejects escaping or unresolved symlinks before changing editor state, and
  validates that the requested cursor position can be represented exactly.
  Hidden targets reuse the most recent source window, then another contained
  source window; they never replace the Pi terminal by treating it as source.
- Reveal suppresses autocommands during its synchronous window operation,
  validates the observed buffer, cursor, focus, and split orientation, and
  rolls back a changed window or partially created split on failure. Explicit
  focus updates the channel's preserved source context without triggering a
  model turn.
- Contract, channel, tool-schema, and headless Neovim tests cover defaults,
  requested focus, horizontal and vertical orientation, exact UTF-8 byte
  columns, final-column placement, hidden loaded buffers, invalid ranges,
  ordinary and symlinked outside-worktree buffers, unresolved target paths,
  autocommand isolation, failed-split rollback, and unchanged source bytes. At
  task completion, the focused suite passes 55 tests; TypeScript and scoped
  Biome checks pass.

### Temporary highlight implementation record

- `highlight` accepts one loaded, modifiable source buffer and a non-empty
  one-based byte range with an exclusive end. It defaults to the full requested
  line and a 2-second duration, caps ranges at 500 lines and durations at 30
  seconds, and never changes windows, focus, cursors, or source text.
- Fixed Lua verifies canonical worktree containment before creating a `Search`
  extmark. Each Pi RPC channel gets a distinct highlight namespace, so expiry,
  explicit `clear_highlight`, and session cleanup cannot remove another
  channel's presentation state.
- The bridge checks the created extmark's observed range and highlight group,
  removes it if response validation fails, drains in-flight presentation calls
  before shutdown cleanup, and treats repeated expiry or removal as
  idempotent. Session shutdown clears every remaining highlight owned by that
  channel.
- Contract, channel, tool-schema, and headless Neovim tests cover range and
  duration defaults and limits, exact UTF-8 end columns, automatic expiry,
  repeated explicit removal, readonly and outside-worktree rejection,
  malformed-response rollback, in-flight shutdown, cross-channel isolation,
  unchanged changedtick, cursor, window state, unsaved text, and disk bytes. At
  task completion, the focused suite passes 60 tests; TypeScript and scoped
  Biome checks pass.

### Atomic annotation implementation record

- `annotate` accepts at most ten literal source anchors in one request. It uses
  the requested line when possible, otherwise searches only when the loaded
  buffer remains within 1,000 lines and 256 KiB. Missing and non-unique anchors
  reject the complete batch.
- Neovim resolves every anchor before creating extmarks. Each channel owns its
  annotation namespace and batch IDs, may hold at most 50 active annotations,
  and removes every batch on expiry or session cleanup. Failed extmark or timer
  creation rolls back the complete batch.
- Responses bind each annotation to its input index, resolved byte column,
  source-line byte length, buffer line count, batch ID, and expiry. TypeScript
  validates those observations and asks Neovim to remove the batch after any
  malformed or uncertain response.
- Headless RPC tests cover shifted and UTF-8 anchors, stale and ambiguous
  anchors, search and active limits, partial extmark rollback, expiry,
  read-only and outside-worktree rejection, session cleanup, and unchanged
  text, changedtick, cursor, focus, windows, and disk bytes.

### Bridge module implementation record

- TypeScript now sends one allowlisted operation envelope through the fixed
  `require("plugins.ai.pi.bridge").dispatch(...)` RPC entrypoint. The Neovim module
  owns editor access, per-channel context, extmarks, timers, notifications, and
  cleanup; TypeScript keeps tool schemas, response validation, and timeouts.
- Launcher source context is passed directly to `plugins.ai.pi.bridge` instead of a
  shared `vim.g` value. Closing one RPC channel therefore removes only that
  channel's state and leaves another channel's preserved source context intact.

### Tracer bullet

1. Populate a Neovim quickfix list.
2. Ask Pi to inspect one entry.
3. Ask Pi to reveal the source without taking focus.
4. Explicitly ask it to focus the source.
5. Ask Pi to highlight the affected range and add an annotation.
6. Clear the annotation and highlight.
7. Verify that no source text changed.

### Exit criterion

Pi can inspect and present editor locations with the same containment and
non-mutation guarantees as the OpenCode bridge.

### Verification record

- An isolated live Neovim tracer connected through the production
  `PiNeovimChannel` and inspected one quickfix entry at line 1, byte column 7.
- A focus-preserving reveal updated source window `1000` while the terminal
  remained active in window `1002`. The explicit-focus reveal then selected
  source window `1000` and placed the cursor at Neovim position `[1, 6]`, which
  is the requested one-based byte column 7.
- The tracer observed the temporary highlight extmark at `[0, 6]`, removed it
  explicitly, and then observed no highlight. Its shifted annotation resolved
  from requested line 1 to line 2, byte column 1, and channel shutdown removed
  the annotation batch.
- Source lines and changedtick remained unchanged. The disk SHA-256 was
  `fb9958b22c5a120bf8c170ceadf88f864d79b8e2775263e398adbe5eafd6d9d0`
  before and after the complete tracer.
- The full Pi agent suite passes with 689 tests and 2,038 assertions. The
  TypeScript typecheck, scoped Biome check, Lua diagnostics, StyLua check,
  launcher fixture, strict OpenSpec validation, and `git diff --check` also
  pass.

## Phase 5: Integrate the embedded Pi lifecycle with Herdr

**Depends on:** Phase 3

### Outcome

A Pi session launched inside Neovim reports one correct title and lifecycle
state to the owning Herdr pane.

### Delivery

Validate and reuse:

- `.pi/agent/extensions/herdr/` for user-owned title, prompt, cwd, and embedded lifecycle integration
- `.pi/agent/extensions/herdr-agent-state.ts` for Herdr's generated standalone-Pi lifecycle integration

Add only the wiring required to associate embedded Pi with the parent Neovim
pane. Do not add a second lifecycle reporter.

### Automated checks

- Exactly one title source is active.
- Working, idle, blocked, and error transitions target the correct pane.
- Permission and question prompts report blocked state.
- Session resume restores the same title and pane association.
- Shutdown clears agent state.
- Herdr remains the owner of panes and workspaces.

### Tracer bullet

1. Launch Pi from a Herdr-managed Neovim pane.
2. Rename the Pi session.
3. Start a model turn.
4. Trigger a permission or question prompt.
5. Settle the prompt and complete the turn.
6. Verify title, working, blocked, and idle transitions in Herdr.
7. Verify that Herdr refuses to close the active pane where required.
8. Exit Pi and confirm that the state clears.

### Exit criterion

Embedded and standalone Pi sessions report lifecycle state without duplicate or
stale Herdr records.

### Verification record (2026-09-04)

- Focused fixtures passed for direct and embedded launch modes: one exclusive
  lifecycle source, title association, working/blocked/idle transitions, and a
  sequenced embedded shutdown release.
- An isolated Herdr v0.8.2 tracer passed session rename, working, question-blocked,
  completed-idle, presentation label, and shutdown cleanup. After Pi exited,
  `agent get` returned `agent_not_found` while Neovim remained alive.
- Herdr's close API does not protect an ordinary or main-worktree pane because
  `pane.close` bypasses interactive confirmation. It protects only implicit
  linked-worktree-group closure. The active-pane close check therefore remains
  unsupported upstream rather than being approximated by the integration.

## Phase 6: Gate editor-owned diff review

**Depends on:** Phases 1 and 2

### Outcome

Pi either gains a verified Neovim accept/reject workflow or OpenCode remains the
explicit owner of editor-side diff review.

### Decision gate

Inspect public Pi and selected IDE integration APIs before implementation. The
required contract is:

- Pi proposes an edit.
- Neovim displays the proposed change.
- The user can modify the proposed result.
- Reject leaves the source unchanged.
- Accept writes exactly the reviewed contents.
- Cancellation is safe.
- The request remains bound to the correct worktree.

Do not treat Pi's file-change bookkeeping as equivalent to editor-owned review.

### Delivery

Start with one file and one proposed edit. Expand only after that path passes.

### Automated checks

- Reject leaves disk and buffer contents unchanged.
- Accept writes the reviewed contents, not the original proposal.
- Cancellation performs no write.
- Changed-on-disk and stale-buffer conflicts fail clearly.
- Unavailable or wrong-worktree editors fail closed.

### Tracer bullet

1. Ask Pi to propose a one-file edit in a temporary repository.
2. Review it in Neovim and reject it.
3. Verify byte-for-byte unchanged source.
4. Repeat, modify the proposed result in Neovim, and accept it.
5. Verify that the modified reviewed result is written.
6. Repeat with a sibling worktree and confirm isolation.

### Exit criterion

- **Pass:** Pi becomes the owner of Neovim diff review.
- **Unsupported:** Record the missing API and retain `opencode.nvim` for this
  workflow.

Do not patch private Pi renderer internals to force parity.

### Decision record (2026-09-04): OpenCode retained

Pi 0.84.4 publicly supports same-name `edit` and `write` overrides, native
renderer inheritance, diff generation, and an in-process mutation queue. It
does not expose an editor-review transaction or an atomic compare-and-write
primitive. The queue coordinates Pi tools only; it cannot prevent a Neovim,
shell, or external write between validation and commit. The current Neovim
bridge intentionally has no source-text mutation or review protocol.

The evaluated public IDE integration,
[`pi-vscode-sr` at `b6129f9`](https://github.com/Serhioromano/pi-vscode-sr/tree/b6129f95551811c9db07c8cfcdfa8ded245ff385),
also misses the required contract: it ignores editor-returned final content,
writes the original proposal, performs no stale-content revalidation, permits
paths outside the worktree, and bypasses review when the editor heartbeat is
absent. The installed Delta extension already owns Pi's first effective `edit`
override, so another independent override would not compose with it.

Implementing this safely would require a new public review transaction spanning
Pi and Neovim, including cancellation, versioned source snapshots, and a
compare-and-write commit. No private renderer patch, tool override, or new IDE
dependency was added. `opencode.nvim` remains the explicit owner of editor-side
diff review.

## Phase 7: Gate clickable patch navigation

**Depends on:** Phase 1

### Outcome

Clicking a Pi-rendered changed-file header opens the correct file and first
changed line in the bound Neovim instance.

### Decision gate

Confirm that Pi exposes a supported public API for clickable rendered output.
If it does not, retain this feature in OpenCode.

### Delivery

Reuse the pure parsing behavior from:

- `.config/opencode/plugins/neovim-integration/patch-navigation-core.ts`

Adapt the TUI wiring only through supported Pi APIs.

### Automated checks

- Patched, created, and moved paths are recognized.
- Deleted and unrelated headers are ignored.
- The first changed new-file line is selected.
- Text selection suppresses click handling.
- Escaping the worktree is rejected.
- Malformed output produces no action.

### Tracer bullet

1. Have Pi produce a multi-file change.
2. Click a changed-file header in the Pi TUI.
3. Verify that the bound Neovim instance opens the correct file and line.
4. Repeat while text is selected and verify no navigation occurs.
5. Test a crafted outside-worktree path and verify rejection.

### Exit criterion

- **Pass:** Enable Pi patch navigation.
- **Unsupported:** Retain OpenCode patch navigation and document it as an
  intentional exception.

### Decision record (2026-09-04): OpenCode retained

Pi 0.84.4's public component contract exposes rendering, keyboard input, and
invalidation, but no mouse or click callback. Tool renderers receive no TUI
instance or component bounds. The raw terminal-input hook does not expose
rendered row ownership or fullscreen selection state, so parsing mouse escape
sequences there cannot safely associate a click with one patch header.

Pi can render OSC 8 links. In fullscreen mode, however, Pi owns their activation
and routes every URL through its fixed `openBrowser` callback; extensions cannot
replace that callback with the bound Neovim channel. Main-screen activation is
left to the terminal emulator. Neither path proves the launching Neovim
instance, preserves worktree isolation, or exposes the required selection
suppression contract.

Adding click behavior would therefore require a public renderer action API or a
supported hyperlink dispatch hook. No Delta renderer, Pi TUI internal, or
private output tree was patched. OpenCode's tested patch-navigation integration
remains the intentional owner.

## Phase 8: Switch Neovim's default agent to Pi

**Depends on:** All required phases and decisions from Phases 6 and 7

### Outcome

Neovim launch, focus, and bounded editor-context actions use Pi. OpenCode
remains an explicit rollback command during a retention period. Generic Ask and
prompt-append behavior were not migrated by this phase; their replacement is
planned in
[`2026-09-05-pi-neovim-prompt-bridge.md`](./2026-09-05-pi-neovim-prompt-bridge.md).

### Delivery

- Add Pi equivalents for the current OpenCode launch, focus, selection, and
  visible-buffer actions.
- Switch existing Neovim AI keymaps to Pi where verified.
- Keep a separate OpenCode launch command and keymap for rollback.
- Record every capability as:
  - Pi
  - OpenCode retained
  - Retired
- Remove active OpenCode Neovim wiring only after the rollback period.

### Capability matrix

| Neovim workflow                                                  | Owner             | Evidence                                                              |
| ---------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------- |
| Launch, toggle, and terminal focus                               | Pi                | `test:nvim-pi-launcher`, `test:nvim-pi-cutover`, Phase 1 live tracer  |
| Active and preserved source context                              | Pi                | `extensions/neovim` focused suite, Phase 1 live tracer                |
| Exact visual selection                                           | Pi                | `test:nvim-pi-launcher`, Phase 1 live tracer                          |
| Visible and listed buffers                                       | Pi                | `extensions/neovim` focused suite, Phase 2 live tracer                |
| Unsaved buffer reads and Neovim diagnostics                      | Pi                | `extensions/neovim` focused suite, Phase 2 unchanged-disk tracer      |
| Quickfix and location lists                                      | Pi                | `extensions/neovim` focused suite, Phase 4 presentation tracer        |
| Reveal, highlight, annotation, and cleanup                       | Pi                | `extensions/neovim` focused suite, Phase 4 unchanged-source tracer    |
| Exact editor-owned session restoration                           | Pi                | Neovim/Herdr restoration fixtures, Phase 3 two-worktree tracer        |
| Herdr title and lifecycle state                                  | Pi                | Herdr extension fixtures, Phase 5 isolated lifecycle tracer           |
| Editor-owned editable diff review                                | OpenCode retained | Phase 6 public-API decision record                                    |
| Clickable patch-header navigation                                | OpenCode retained | Phase 7 public-API decision record                                    |
| OpenCode actions, session selection, and prompt presets          | OpenCode retained | `test:nvim-opencode-session-restore`; active `opencode.nvim` mappings |
| Ask input and prompt submission previously owned by `<leader>ac` | OpenCode retained | New prompt-bridge plan; no current Pi prompt-ingress API              |
| Prompt append previously owned by `ga` and `<A-x>`               | OpenCode retained | New prompt-bridge plan; current Pi mappings only record context       |

The default Pi mappings are `<A-a>` for toggle, `<C-\\>` for focus,
`<leader>ac` and `ga` for source-context capture, and `<A-x>` for selection or
visible-buffer context capture. The latter three do not reproduce the prior Ask
or append interactions and are not prompt-cutover evidence. `:OpenCodeStart`,
`:OpenCodeToggle`, and `<leader>aO` remain the explicit rollback entry points.

### Complete live matrix

Verify:

- Correct socket and worktree binding
- Active and focused source context
- Exact visual selection
- Visible and listed buffers
- Unsaved buffer reads
- Neovim diagnostics
- Quickfix and location lists
- Reveal
- Highlight and annotation
- Exact Pi session restoration
- Herdr title and lifecycle state
- Diff accept/reject, if supported
- Clickable patch navigation, if supported
- Missing editor behavior
- Stale socket behavior
- Sibling-worktree isolation

### Consolidated matrix record (2026-09-04)

The full matrix combines the isolated live tracer bullets above with a fresh
post-cutover regression run. No bridge operation changed during keymap cutover.

- Phase 1's two-worktree live tracer verified fixed-socket identity, active and
  preserved focus context, exact selection, notification isolation, and
  `NVIM_UNAVAILABLE` on a cross-bound socket.
- Phase 2's live tracer verified visible buffers, unsaved reads, Neovim
  diagnostics, and unchanged disk bytes.
- Phase 4's live tracer verified quickfix, focus-preserving and explicit-focus
  reveal, highlight, annotation, cleanup, and unchanged source hashes.
- Phase 3's two-worktree Herdr restore tracer verified exact IDs, Neovim-first
  resume, sibling-worktree refusal, and unchanged Pi session files.
- Phase 5's isolated Herdr tracer verified title, working, blocked, completed
  idle, and shutdown cleanup while Neovim remained alive.
- The post-cutover Pi/Neovim and Herdr suite passed 75 tests with 423 assertions.
  It re-exercised real headless Neovim RPC plus missing socket, stale socket,
  invalid identity, unavailable editor, outside-worktree, and sibling-worktree
  failures. Seven Neovim/Herdr restoration, launcher, rollback, inventory, and
  lazy-startup tasks also passed.
- Diff review and clickable patch navigation were excluded from Pi's live path
  according to their Phase 6 and 7 gates; OpenCode remains their tested owner.
- After the Pi matrix passed, the cutover fixture invoked `:OpenCodeStart` and
  `:OpenCodeToggle`, then the independent OpenCode restoration fixture started
  the rollback terminal and exercised its buffer-local return-to-editor key.

### Repository validation

Run the smallest relevant checks for each slice, then the combined checks:

```sh
just stow-check
devenv tasks run test:stow
devenv test
```

Also confirm:

- No credentials or session state entered Git.
- No generated lockfiles changed unexpectedly.
- OpenCode still starts independently.
- Existing Pi LSP, handoff, and Herdr tests still pass.

### Repository validation record (2026-09-05)

- `just stow-check`, `devenv tasks run test:stow`, and `devenv test` pass. The
  full Devenv graph includes the new `test:nvim-pi-cutover` dependency.
- The Stow fixture now excludes `.pi/skills`, matching the repository rule that
  Pi discovers these project-local skills in place. `.config/opencode/command`
  is also excluded from Stow, matching its existing local Git ignore.
- The complete Pi suite passes 724 tests with 2,109 assertions; TypeScript,
  scoped Neovim/Herdr Biome checks, Neovim Lua quality, and `git diff --check`
  pass.
- `ripsecrets` found no credentials in the integration, migration, or fixture
  paths. Git status contains no session state, credential files, Neovim pack
  lock, or generated AGS typings.
- The repository-wide Pi `bun run check` remains independently blocked by an
  existing Biome newline finding in clean `.pi/agent/settings.json` and the
  known Fallow unused export at `benchmarks/startup-shutdown.ts:36`. Neither
  file is part of this migration.
- A final cutover review found and fixed cross-session terminal reuse before
  context capture, ambiguous previous-window return behavior, SQL wildcard
  matching in the retained OpenCode fallback, and an ambient `pi` dependency in
  the launcher fixture. The focused Neovim tasks and final `devenv test` pass
  after these fixes.
- Concurrent non-migration work was preserved and was not edited or attributed
  to this migration.

### Rollback retention

OpenCode has no automatic expiry. Keep `opencode.nvim`, its session metadata,
its prompt/session mappings, and `:OpenCodeStart`, `:OpenCodeToggle`, and
`<leader>aO` until a separate approved cleanup change repeats this matrix after
at least one Pi upgrade. Diff review and clickable patch navigation remain
OpenCode-owned until supported Pi public APIs pass their Phase 6 and 7 gates.

### Cutover criterion

Switch the default only when:

- Every required workflow has an independent live result.
- No test has attached Pi to the wrong Neovim instance.
- Rejecting an editor review has never changed source content.
- Session restoration uses exact IDs rather than inference.
- The OpenCode rollback path has been exercised after the switch.

Full parity does not require unsupported features to be recreated. Diff review
or clickable navigation may remain OpenCode-owned if Pi lacks a stable public
integration point.
