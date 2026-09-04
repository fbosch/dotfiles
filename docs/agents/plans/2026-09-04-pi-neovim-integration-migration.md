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

## Phase 3: Restore the exact Pi session through Neovim

**Depends on:** Phase 1

### Outcome

Herdr restores Neovim, then Neovim resumes the exact Pi session recorded in its
session metadata.

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
