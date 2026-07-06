## 1. Text Input Rejection

- [x] 1.1 Add the minimal guarded keyboard request/result types for explicit keys, chords, sequences, and target identity.
- [x] 1.2 Reject free-form text input before approval, target, or backend checks run.
- [x] 1.3 Write rejection evidence with requested input and text-input-unsupported reason.
- [x] 1.4 Add tests proving arbitrary text is rejected without invoking an input backend.

## 2. Approval Required for Game Key

- [x] 2.1 Add a guarded keyboard mode that evaluates app approval for the resolved game target.
- [x] 2.2 Reject an explicit key when approval returns `ask` and no explicit one-turn approval is supplied.
- [x] 2.3 Include the approval prompt metadata and before capture in the result so the agent can ask the user.
- [x] 2.4 Add tests proving `steam_app_default` / `infinitefusion` returns approval-required for `ArrowUp` without sending input.

## 3. No Backend Available After Approval

- [x] 3.1 Accept an explicit one-turn approval for the exact approved target identity.
- [x] 3.2 Revalidate the current target immediately before backend evaluation.
- [x] 3.3 Return `no-input-backend` when the target is approved but Hyprland targeted dispatch is unavailable.
- [x] 3.4 Write before/after-or-rejection evidence proving no input backend was invoked.
- [x] 3.5 Add tests proving an approved game target fails closed with `no-input-backend`.

## 4. Target Drift Rejection

- [x] 4.1 Store the approved target identity from the approval decision.
- [x] 4.2 Re-read Hyprland state immediately before input and compare stable ID, class, title, workspace, and monitor.
- [x] 4.3 Reject when focus moved to another window between approval and execution.
- [x] 4.4 Write drift evidence with approved and current target metadata.
- [x] 4.5 Add tests proving drift from game window to terminal rejects before backend invocation.

## 5. Unsafe Target Denials

- [x] 5.1 Reject allowlisted keys for terminal targets and recommend shell tools.
- [x] 5.2 Reject allowlisted keys for OpenCode/Codex/tool-permission targets.
- [x] 5.3 Reject allowlisted keys for privileged/authentication/permission prompt targets.
- [x] 5.4 Reject browser page interaction and recommend `agent-browser` or `chrome-devtools`.
- [x] 5.5 Add tests proving all denied approval states block keyboard execution before backend invocation.

## 6. Hyprland Dispatcher Backend Success

- [x] 6.1 Add a Hyprland dispatcher backend that targets `stableid:<stableId>` when available and records the selector.
- [x] 6.2 Send one explicit key through `hl.dsp.send_shortcut` or `hl.dsp.send_key_state` only after approval and target revalidation pass.
- [x] 6.3 Capture before and after evidence around the key send.
- [x] 6.4 Add tests proving one approved `ArrowUp` key records backend, selector, target, input, before capture, and after capture.

## 7. Chords and Sequences

- [x] 7.1 Add parsing for explicit key chords such as `Ctrl+S` and `Alt+Enter`.
- [x] 7.2 Add parsing for short key sequences of explicit keys/chords.
- [x] 7.3 Reject unsupported chords before backend invocation.
- [x] 7.4 Add tests proving chords and sequences dispatch through the Hyprland backend in order.

## 8. Documentation and Validation

- [x] 8.1 Document guarded keyboard scope, explicit key/chord/sequence model, text-input boundary, approval requirement, target drift checks, Hyprland dispatcher backend, and denied targets.
- [x] 8.2 Update Hyprland feasibility docs to mark guarded keyboard as the first narrow input-control slice.
- [x] 8.3 Run `bun test` in `.config/opencode/plugins/hypr-computer-use`.
- [x] 8.4 Run `bunx tsc --noEmit` in `.config/opencode/plugins/hypr-computer-use`.
- [x] 8.5 Run `bunx tsc --noEmit` in `.config/opencode/plugins`.
- [ ] 8.6 Smoke-test live guarded keyboard rejection paths after restarting OpenCode if the tool schema changes.
