## 1. Bind Pi to the launching Neovim instance

- [x] 1.1 Define the Pi editor tool, error, and inbound notification contracts, including stable error codes, source identity, allowlisted events, payload bounds, the prohibition on event-triggered model turns, and worktree containment; verify focused contract tests cover every boundary.
- [x] 1.2 Add an opt-in Neovim Pi launcher that passes only `vim.v.servername` through `PI_NVIM_SOCKET` and leaves existing OpenCode commands and keymaps unchanged; verify a headless Neovim test captures the expected launch command and environment.
- [x] 1.3 Add a Pi extension that lazily opens one persistent Msgpack-RPC channel from the inherited socket, obtains its channel identity, and exposes connection status without socket arguments or discovery; verify missing, stale, and alternate active sockets fail closed.
- [x] 1.4 Add an allowlisted asynchronous Neovim notification dispatcher with session-shutdown cleanup; verify valid focus events update extension state while unknown or malformed events cannot invoke commands, submit prompts, or trigger model turns.
- [x] 1.5 Implement one editor context operation that combines active context, last-source focus fallback, and exact visual selection with fixed bridge-owned Lua; verify tests cover normal, terminal-focused, absent-selection, invalid-response, and bounded-selection cases.
- [x] 1.6 Run the live bidirectional connection tracer bullet in the main and a sibling worktree; record evidence that each Pi session reads only its launching editor and receives only its editor's focus notifications before marking the slice complete.

## 2. Read live buffers and Neovim diagnostics

- [ ] 2.1 Implement visible-window and listed-source-buffer inventory with bound-instance and source identities; verify tests cover modified, loaded, unlisted, unnamed, special, and cross-worktree buffers.
- [ ] 2.2 Implement bounded in-memory buffer reads without filesystem fallback; verify an integration test returns unsaved text while the on-disk file remains unchanged.
- [ ] 2.3 Implement Neovim diagnostic summaries and detailed diagnostic reads as distinct from Pi LSP results; verify ordering, positions, severities, limits, and invalid-buffer errors.
- [ ] 2.4 Run the live unsaved-buffer tracer bullet with two visible files and an unsaved diagnostic; record the returned Neovim state and unchanged disk contents.

## 3. Restore the exact Pi session through Neovim

- [ ] 3.1 Confirm Pi 0.84.4's supported exact session ID, project identity, and resume invocation from Pi documentation and runtime behavior; record the verified contract before implementing persistence.
- [ ] 3.2 Add separate `pi_session_id` and Pi terminal-open metadata without changing `opencode_session_id`; verify Neovim session tests preserve both products' fields across save and load.
- [ ] 3.3 Resume only the persisted Pi session whose project and worktree identity match the restored Neovim session; verify exact resume, closed-terminal, missing-session, invalid-session, and wrong-worktree tests.
- [ ] 3.4 Preserve the restoration order `Herdr → Neovim → exact Pi session`; verify existing Herdr restore tests and new Pi-specific restoration fixtures pass.
- [ ] 3.5 Run the live restore tracer bullet in two sibling worktrees; record exact session continuity and prove neither worktree resumes the other's session.

## 4. Add problem-list navigation and source presentation

- [ ] 4.1 Implement bounded quickfix and location-list inspection with explicit list ownership and source positions; verify default, maximum, empty, invalid-window, and oversized-list cases.
- [ ] 4.2 Implement worktree-contained reveal with explicit focus and split options; verify exact line and column placement, focus preservation, requested focus, and outside-worktree rejection.
- [ ] 4.3 Implement bridge-owned temporary highlights and explicit removal; verify duration bounds, automatic expiry, cleanup, invalid ranges, and unchanged buffer text.
- [ ] 4.4 Implement atomic bounded annotations with source-text anchors; verify stale anchors and any invalid item reject the whole batch without partial extmarks or text changes.
- [ ] 4.5 Run the live presentation tracer bullet covering quickfix inspection, reveal with and without focus, highlight, annotation, cleanup, and unchanged source hashes.

## 5. Integrate embedded Pi with existing Herdr reporting

- [ ] 5.1 Trace direct and Neovim-launched Pi environment and reporter ownership; verify a focused fixture demonstrates whether additional parent-pane wiring is required.
- [ ] 5.2 Add only the missing pane association to the existing Pi title, state, and permission reporters; verify exactly one title and lifecycle source handles working, blocked, idle, error, and shutdown transitions.
- [ ] 5.3 Verify resumed editor sessions retain the correct Herdr pane association without making Pi a restoration owner; run existing Pi Herdr tests and Herdr Neovim restoration tests.
- [ ] 5.4 Run the live Herdr tracer bullet covering rename, active work, permission or question blocking, completion, close protection, and state cleanup.

## 6. Decide and implement editor-owned diff review

- [ ] 6.1 Inspect Pi 0.84.4 and the selected IDE integration's public APIs for editable Neovim diff review; record whether they can guarantee unchanged source on reject and cancellation and exact reviewed contents on accept.
- [ ] 6.2 If the public contract is sufficient, implement one-file review with stale-buffer and wrong-worktree protection; verify automated reject, modified-accept, cancellation, unavailable-editor, and sibling-worktree cases.
- [ ] 6.3 If the public contract is insufficient, record diff review as `OpenCode retained` with the missing API and verify no private Pi or renderer patch was added.
- [ ] 6.4 When implemented, run the live diff tracer bullet by rejecting one edit and accepting a user-modified version of the same edit; record byte-for-byte source evidence for both outcomes.

## 7. Decide and implement clickable patch navigation

- [ ] 7.1 Inspect Pi 0.84.4 for a supported public rendered-output click API; record whether patch-header navigation can be implemented without private renderer access.
- [ ] 7.2 If the public contract is sufficient, adapt the pure patch path and first-changed-line parser with selection suppression and worktree containment; verify patched, created, moved, deleted, malformed, selected-text, and escaping-path cases.
- [ ] 7.3 If the public contract is insufficient, record patch navigation as `OpenCode retained` and verify no private Pi renderer patch was added.
- [ ] 7.4 When implemented, run the live click tracer bullet against a multi-file Pi change and record that the bound Neovim instance opens the correct file and line.

## 8. Switch verified Neovim workflows to Pi

- [ ] 8.1 Create a capability matrix that marks every current Neovim workflow as `Pi`, `OpenCode retained`, or `retired` and links each Pi entry to automated and live evidence.
- [ ] 8.2 Add Pi equivalents for verified launch, focus, selection, and visible-buffer actions while preserving an explicit OpenCode rollback command; verify Neovim keymap tests cover both paths without collisions.
- [ ] 8.3 Run the full live matrix for socket isolation, active and focus context, selection, visible and unsaved buffers, diagnostics, problem lists, navigation, presentation, restoration, Herdr lifecycle, and supported gated capabilities; record missing-editor, stale-socket, and sibling-worktree failures.
- [ ] 8.4 Run `just stow-check`, `devenv tasks run test:stow`, and `devenv test`; verify no credentials, session state, generated lockfiles, or unrelated changes enter the diff.
- [ ] 8.5 Exercise the explicit OpenCode rollback after the Pi checks pass, then switch Neovim's default agent to Pi only when every required capability has a resolved status.
- [ ] 8.6 Update the migration records with the cutover result and retain active OpenCode Neovim wiring until the documented rollback period ends.
