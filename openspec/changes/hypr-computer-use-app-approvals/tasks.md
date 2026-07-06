## 1. Unknown Normal App Prompt

- [ ] 1.1 Add the minimal app identity and approval decision types needed to represent an unknown normal app prompt.
- [ ] 1.2 Derive identity from the active Hyprland client, including class, title, PID, workspace, monitor, window address, and partial confidence when desktop metadata is unavailable.
- [ ] 1.3 Return `ask` for an unknown normal app with prompt metadata, requested route, and requested action summary.
- [ ] 1.4 Write approval evidence for the `ask` decision without reading clipboard contents or inlining screenshot bytes.
- [ ] 1.5 Add tests proving an unknown normal app returns `ask` with prompt metadata and evidence.

## 2. Terminal GUI Denial

- [ ] 2.1 Add terminal target detection from app identity class/title metadata.
- [ ] 2.2 Return `denied` for terminal GUI automation and recommend normal OpenCode shell tools.
- [ ] 2.3 Write denial evidence with the matched terminal signal and requested route.
- [ ] 2.4 Add tests proving terminal GUI targets are denied and do not fall back to click/type/clipboard paths.

## 3. OpenCode Self-Target Denial

- [ ] 3.1 Add OpenCode/Codex/agent approval/tool-permission target detection from class/title metadata.
- [ ] 3.2 Return `denied` for self-automation and approval-bypass targets.
- [ ] 3.3 Write denial evidence with matched self-target signals.
- [ ] 3.4 Add tests proving OpenCode/Codex targets are denied before any route can be approved.

## 4. Privileged Prompt Denial

- [ ] 4.1 Add conservative privileged-prompt and permission-dialog detection from class/title metadata.
- [ ] 4.2 Return `denied` for sudo, Polkit, keychain, password, authentication, system security, and browser permission prompts.
- [ ] 4.3 Write denial evidence with matched prompt signals and a human-handling recommendation.
- [ ] 4.4 Add tests proving privileged and permission prompts are denied by default.

## 5. Missing and Ambiguous Target Handling

- [ ] 5.1 Return a missing-target denial when an app approval request requires a target and no client can be resolved.
- [ ] 5.2 Return an ambiguous-target decision with candidate metadata when multiple clients match an app hint.
- [ ] 5.3 Write evidence for missing-target and ambiguous-target outcomes.
- [ ] 5.4 Add tests for missing active target and multiple matching app candidates.

## 6. Sensitive Context Classification

- [ ] 6.1 Add sensitive-signal detection for account, payment, credential, privacy, security, and browser-permission contexts that are not categorically denied.
- [ ] 6.2 Return `sensitive` with matched signals and the reason ordinary app approval is insufficient.
- [ ] 6.3 Ensure an approved app target still returns `sensitive` when the request context is sensitive.
- [ ] 6.4 Write sensitive-decision evidence without sensitive content capture.
- [ ] 6.5 Add tests proving sensitive context overrides normal approval.

## 7. Browser App Approval Boundary

- [ ] 7.1 Evaluate browser app targets for desktop visibility or window-management approval without granting page interaction authority.
- [ ] 7.2 Return recommendations for `agent-browser` or available `chrome-devtools` tools for browser page interaction.
- [ ] 7.3 Write evidence showing the app approval boundary and delegated browser route.
- [ ] 7.4 Add tests proving browser app approval does not select in-plugin browser page automation.

## 8. Persistence Boundary

- [ ] 8.1 Treat one-time approval as scoped to the current route decision only.
- [ ] 8.2 Reject persistent `Always allow` requests until a separate persistent policy capability exists.
- [ ] 8.3 Document approval states, default denials, sensitive decisions, browser delegation, and the persistence boundary.
- [ ] 8.4 Add tests proving persistent approval mutation is rejected.

## 9. Validation

- [ ] 9.1 Run `bun test` in `.config/opencode/plugins/hypr-computer-use`.
- [ ] 9.2 Run `bunx tsc --noEmit` in `.config/opencode/plugins/hypr-computer-use`.
- [ ] 9.3 Run `bunx tsc --noEmit` in `.config/opencode/plugins`.
- [ ] 9.4 Smoke-test the live approval output after restarting OpenCode if the tool schema changes.
