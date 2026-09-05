## 1. Correct Prompt Ownership

- [x] 1.1 Restore `<leader>ac`, `ga`, and `<A-x>` to OpenCode Ask and append
      behavior while preserving Pi focus/toggle, and verify the Neovim cutover and
      OpenCode restoration fixtures
- [x] 1.2 Add an explicit OpenCode Ask command and verify it opens the retained
      Snacks Ask workflow without changing Pi state
- [x] 1.3 Record Ask and append as OpenCode-retained in the predecessor migration
      artifacts and pass strict validation for both OpenSpec changes

## 2. Prove Public Pi Ingress

- [x] 2.1 Add a focused extension proof that idle
      `sendUserMessage(..., { expandPromptTemplates: false })` emits one extension
      input and starts one turn, while busy state sends nothing
- [x] 2.2 Prove TUI editor append with `getEditorText` and `setEditorText`, including
      exact existing-text preservation and zero user-message dispatches
- [x] 2.3 Verify the proof imports no private Pi module and record the Pi 0.84.4
      result in the migration plan

## 3. Define the Prompt Protocol

- [ ] 3.1 Add closed TypeScript request and acknowledgement parsers with identifier,
      UTF-8, NUL, prompt, context, request, and sequence bounds, and pass focused
      contract tests
- [ ] 3.2 Add Lua request construction and acknowledgement parsing with matching
      bounds and failure codes, and pass headless boundary tests including
      multibyte text
- [ ] 3.3 Add launch ID generation and bind it to the existing channel, Pi session,
      Neovim owner, editor PID, and canonical worktree; verify stale and sibling
      identities fail closed

## 4. Implement Literal Request Delivery

- [ ] 4.1 Install the explicit `pi:nvim-prompt/v1` notification listener in the
      existing Effect-owned channel and verify passive notifications still produce
      zero submissions
- [ ] 4.2 Dispatch idle literal submit through Pi's public API and reject non-TUI,
      busy, blocked, stale, and replacing-session states in focused tests
- [ ] 4.3 Reserve in-flight request IDs, retain 64 outcomes, and verify pending,
      completed duplicate, changed-content reuse, stale sequence, and sequence-gap
      behavior
- [ ] 4.4 Return `prompt_ack` on the same channel and verify the full notification,
      dispatch, acknowledgement, and pending-request round trip
- [ ] 4.5 Clear prompt listeners, bindings, timers, and request state on disconnect,
      terminal close, reload, session replacement, and shutdown in lifecycle tests

## 5. Ship the Literal PiAsk Canary

- [ ] 5.1 Add preserve-focus terminal start/restore behavior for prompt requests and
      verify normal Pi start/toggle behavior remains unchanged
- [ ] 5.2 Add `:PiAsk [prefill]` with `vim.ui.input`, local validation, cancellation,
      a 10-second binding/acknowledgement deadline, and no default mapping
- [ ] 5.3 Focus Pi only after a matching accepted acknowledgement and verify reject,
      timeout, late acknowledgement, terminal-close, and session-replacement paths
      retain or restore source focus without automatic retry
- [ ] 5.4 Run warm, cold, exact-restored, wrong-session, wrong-socket, and sibling
      worktree live checks before declaring the literal canary complete

## 6. Add Stable Context

- [ ] 6.1 Capture a closed `ActiveContext`-compatible snapshot with source
      eligibility, changed tick, cursor, and all visual modes before input, and pass
      headless stale/reversed/multibyte selection tests
- [ ] 6.2 Render bounded `@this` context as explicitly untrusted data and verify
      cursor and exact unsaved-selection behavior without prompt expansion
- [ ] 6.3 Add Snacks highlighting and completion while preserving native
      `vim.ui.input` behavior, cancellation, and visual selection restoration

## 7. Add Append and Remaining Interactions

- [ ] 7.1 Implement exact Pi TUI editor append with acknowledgements and verify it
      never starts a turn
- [ ] 7.2 Port `ga` and visual and normal `<A-x>` to Pi canaries and verify source
      selection and visible-buffer bounds and exclusions
- [ ] 7.3 Add bounded `@buffer`, `@diagnostics`, `@quickfix`, `@visible`, and
      `@buffers` context with independent failure and truncation tests
- [ ] 7.4 Add a Pi action picker whose entries declare Ask, append, or submit
      behavior and verify unsupported OpenCode review/session actions are absent

## 8. Cut Over and Retain Rollback

- [ ] 8.1 Run the full automated and two-worktree live matrix and record request IDs
      and failure codes without prompt or source content
- [ ] 8.2 Move each verified prompt mapping to Pi without duplicate native package
      ownership and keep any incomplete workflow OpenCode-owned
- [ ] 8.3 Re-exercise OpenCode Ask, append, toggle, restoration, editable diff, and
      clickable navigation after Pi cutover
- [ ] 8.4 Run Lua quality, Pi typecheck and tests, Stow checks, full Devenv tests,
      secret scanning, `git diff --check`, and strict OpenSpec validation, recording
      unrelated baseline failures without suppressing them
