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
- The bridge executes only fixed internal Lua.
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
  terminal owned by the current Neovim session. This also tracks Pi session
  changes made inside the TUI.
- `SessionSavePre` stores the bound ID as `pi_session_id` and records
  `pi_terminal_open`. An open terminal is not marked restorable before the
  identity handshake completes. Closing the terminal changes only the open flag
  and keeps the last exact ID available for restoration decisions.
- Pi metadata updates preserve `opencode_session_id`,
  `opencode_terminal_open`, and other existing Neovim session metadata.
- `devenv tasks run test:nvim-pi-launcher` round-trips both products' fields
  through the JSON metadata file and covers unbound saves, invalid bindings,
  open, close, terminal reuse, and exact manual resume after reopening.
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
  calls to `utils.pi.restore()` returned `false`, opened no terminal, and left
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

## Phase 5: Integrate the embedded Pi lifecycle with Herdr

**Depends on:** Phase 3

### Outcome

A Pi session launched inside Neovim reports one correct title and lifecycle
state to the owning Herdr pane.

### Delivery

Validate and reuse:

- `.pi/agent/extensions/herdr-session-name.ts`
- `.pi/agent/extensions/herdr-agent-state.ts`
- `.pi/agent/extensions/herdr-permission-state.ts`

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

## Phase 8: Switch Neovim's default agent to Pi

**Depends on:** All required phases and decisions from Phases 6 and 7

### Outcome

Normal Neovim agent actions launch Pi. OpenCode remains an explicit rollback
command during a retention period.

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
