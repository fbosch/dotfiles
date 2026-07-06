## 1. Unsupported Key Rejection

- [ ] 1.1 Add the minimal guarded keyboard request/result types for one requested key and target identity.
- [ ] 1.2 Reject keys outside the initial allowlist before approval, target, or backend checks run.
- [ ] 1.3 Write rejection evidence with requested key and unsupported-key reason.
- [ ] 1.4 Add tests proving arbitrary text and non-allowlisted keys are rejected without invoking an input backend.

## 2. Approval Required for Game Key

- [ ] 2.1 Add a guarded keyboard mode that evaluates app approval for the resolved game target.
- [ ] 2.2 Reject an allowlisted key when approval returns `ask` and no explicit one-turn approval is supplied.
- [ ] 2.3 Include the approval prompt metadata and before capture in the result so the agent can ask the user.
- [ ] 2.4 Add tests proving `steam_app_default` / `infinitefusion` returns approval-required for `ArrowUp` without sending input.

## 3. No Backend Available After Approval

- [ ] 3.1 Accept an explicit one-turn approval for the exact approved target identity.
- [ ] 3.2 Revalidate the current target immediately before backend evaluation.
- [ ] 3.3 Return `no-input-backend` when the target is approved but no keyboard backend is configured.
- [ ] 3.4 Write before/after-or-rejection evidence proving no input backend was invoked.
- [ ] 3.5 Add tests proving an approved game target fails closed with `no-input-backend`.

## 4. Target Drift Rejection

- [ ] 4.1 Store the approved target identity from the approval decision.
- [ ] 4.2 Re-read Hyprland state immediately before input and compare stable ID, class, title, workspace, and monitor.
- [ ] 4.3 Reject when focus moved to another window between approval and execution.
- [ ] 4.4 Write drift evidence with approved and current target metadata.
- [ ] 4.5 Add tests proving drift from game window to terminal rejects before backend invocation.

## 5. Unsafe Target Denials

- [ ] 5.1 Reject allowlisted keys for terminal targets and recommend shell tools.
- [ ] 5.2 Reject allowlisted keys for OpenCode/Codex/tool-permission targets.
- [ ] 5.3 Reject allowlisted keys for privileged/authentication/permission prompt targets.
- [ ] 5.4 Reject browser page interaction and recommend `agent-browser` or `chrome-devtools`.
- [ ] 5.5 Add tests proving all denied approval states block keyboard execution before backend invocation.

## 6. Configured Backend Success

- [ ] 6.1 Add an explicit test backend hook for guarded keyboard execution without adding system dependencies.
- [ ] 6.2 Send one allowlisted key through the configured backend only after approval and target revalidation pass.
- [ ] 6.3 Capture before and after evidence around the key send.
- [ ] 6.4 Add tests proving one approved `ArrowUp` key records backend, target, key, before capture, and after capture.

## 7. Documentation and Validation

- [ ] 7.1 Document guarded keyboard scope, allowlist, approval requirement, target drift checks, backend configuration, and denied targets.
- [ ] 7.2 Update Hyprland feasibility docs to mark guarded keyboard as the first narrow input-control slice.
- [ ] 7.3 Run `bun test` in `.config/opencode/plugins/hypr-computer-use`.
- [ ] 7.4 Run `bunx tsc --noEmit` in `.config/opencode/plugins/hypr-computer-use`.
- [ ] 7.5 Run `bunx tsc --noEmit` in `.config/opencode/plugins`.
- [ ] 7.6 Smoke-test live guarded keyboard rejection paths after restarting OpenCode if the tool schema changes.
