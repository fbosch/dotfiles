## 1. Unknown Normal App Prompt

- [x] 1.1 Add the minimal app identity and approval decision types needed to represent an unknown normal app prompt.
- [x] 1.2 Derive identity from the active Hyprland client, including class, title, PID, workspace, monitor, window address, and partial confidence when desktop metadata is unavailable.
- [x] 1.3 Return `ask` for an unknown normal app with prompt metadata, requested route, and requested action summary.
- [x] 1.4 Write approval evidence for the `ask` decision without reading clipboard contents or inlining screenshot bytes.
- [x] 1.5 Add tests proving an unknown normal app returns `ask` with prompt metadata and evidence.

## 2. Terminal GUI Denial

- [x] 2.1 Add terminal target detection from app identity class/title metadata.
- [x] 2.2 Return `denied` for terminal GUI automation and recommend normal OpenCode shell tools.
- [x] 2.3 Write denial evidence with the matched terminal signal and requested route.
- [x] 2.4 Add tests proving terminal GUI targets are denied and do not fall back to click/type/clipboard paths.

## 3. OpenCode Self-Target Denial

- [x] 3.1 Add OpenCode/Codex/agent approval/tool-permission target detection from class/title metadata.
- [x] 3.2 Return `denied` for self-automation and approval-bypass targets.
- [x] 3.3 Write denial evidence with matched self-target signals.
- [x] 3.4 Add tests proving OpenCode/Codex targets are denied before any route can be approved.

## 4. Privileged Prompt Denial

- [x] 4.1 Add conservative privileged-prompt and permission-dialog detection from class/title metadata.
- [x] 4.2 Return `denied` for sudo, Polkit, keychain, password, authentication, system security, and browser permission prompts.
- [x] 4.3 Write denial evidence with matched prompt signals and a human-handling recommendation.
- [x] 4.4 Add tests proving privileged and permission prompts are denied by default.

## 5. Missing and Ambiguous Target Handling

- [x] 5.1 Return a missing-target denial when an app approval request requires a target and no client can be resolved.
- [x] 5.2 Return an ambiguous-target decision with candidate metadata when multiple clients match an app hint.
- [x] 5.3 Write evidence for missing-target and ambiguous-target outcomes.
- [x] 5.4 Add tests for missing active target and multiple matching app candidates.

## 6. Sensitive Context Classification

- [x] 6.1 Add sensitive-signal detection for account, payment, credential, privacy, security, and browser-permission contexts that are not categorically denied.
- [x] 6.2 Return `sensitive` with matched signals and the reason ordinary app approval is insufficient.
- [x] 6.3 Ensure an approved app target still returns `sensitive` when the request context is sensitive.
- [x] 6.4 Write sensitive-decision evidence without sensitive content capture.
- [x] 6.5 Add tests proving sensitive context overrides normal approval.

## 7. Browser App Approval Boundary

- [x] 7.1 Evaluate browser app targets for desktop visibility or window-management approval without granting page interaction authority.
- [x] 7.2 Return recommendations for `agent-browser` or available `chrome-devtools` tools for browser page interaction.
- [x] 7.3 Write evidence showing the app approval boundary and delegated browser route.
- [x] 7.4 Add tests proving browser app approval does not select in-plugin browser page automation.

## 8. Persistence Boundary

- [x] 8.1 Treat one-time approval as scoped to the current route decision only.
- [x] 8.2 Reject persistent `Always allow` requests until a separate persistent policy capability exists.
- [x] 8.3 Document approval states, default denials, sensitive decisions, browser delegation, and the persistence boundary.
- [x] 8.4 Add tests proving persistent approval mutation is rejected.

## 9. Validation

- [x] 9.1 Run `bun test` in `.config/opencode/plugins/hypr-computer-use`.
- [x] 9.2 Run `bunx tsc --noEmit` in `.config/opencode/plugins/hypr-computer-use`.
- [x] 9.3 Run `bunx tsc --noEmit` in `.config/opencode/plugins`.
- [x] 9.4 Smoke-test the live approval output after restarting OpenCode if the tool schema changes.
