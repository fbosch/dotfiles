## 1. Route Decision Contract

- [ ] 1.1 Add route decision types for request class, selected route, policy outcome, target metadata, tool recommendation, and rejection reason.
- [ ] 1.2 Add route categories for structured browser automation, Hyprland visibility, Hyprland-native window management, app-specific structured integration, file/shell handoff, visual inspection, and rejected requests.
- [ ] 1.3 Add policy denial codes for terminal GUI automation, OpenCode self-automation, privileged prompts, locked sessions, implicit clipboard use, missing target, ambiguous target, unsupported request, and unavailable route.

## 2. Read-Only Router Surface

- [ ] 2.1 Add a read-only route decision tool or mode that accepts a natural-language request and optional target hint.
- [ ] 2.2 Resolve relevant Hyprland state for desktop-level requests and include active or candidate target metadata in the decision.
- [ ] 2.3 Return browser requests as recommendations for `agent-browser` or available `chrome-devtools` tools instead of implementing browser interaction.
- [ ] 2.4 Return file/shell-suitable requests as recommendations for normal OpenCode file or shell tools instead of terminal GUI automation.
- [ ] 2.5 Fail closed when the request class, target, policy, or route availability is uncertain.

## 3. Policy Evaluation

- [ ] 3.1 Implement target checks for terminal emulator classes/titles and reject GUI automation against them.
- [ ] 3.2 Implement target checks for OpenCode/Codex/agent approval windows and reject self-automation.
- [ ] 3.3 Implement conservative privileged-prompt and permission-dialog detection using window class/title metadata.
- [ ] 3.4 Reject locked-session and clipboard routes until explicit future capabilities exist.
- [ ] 3.5 Keep policy checks data-driven enough for tests without adding persistent allow rules.

## 4. Evidence and Documentation

- [ ] 4.1 Write route decision evidence records with timestamp, request class, selected route, target metadata, policy outcome, recommendation, or rejection reason.
- [ ] 4.2 Update plugin docs with the action-router boundary and examples of delegated browser, shell/file, visual, and rejected routes.
- [ ] 4.3 Update feasibility docs so the build order reflects action routing before any optional side-effecting executor.

## 5. Tests and Validation

- [ ] 5.1 Add unit tests for browser, visibility, window-management, app-content, shell/file, and unknown request classification.
- [ ] 5.2 Add unit tests for missing target, ambiguous target, terminal GUI, OpenCode self-target, privileged prompt, locked-session, and clipboard rejection.
- [ ] 5.3 Add unit tests proving browser requests recommend external browser tools and do not create BiDi/CDP sessions inside the plugin.
- [ ] 5.4 Run `bun test` in `.config/opencode/plugins/hypr-computer-use`.
- [ ] 5.5 Run `bunx tsc --noEmit` in `.config/opencode/plugins/hypr-computer-use`.
- [ ] 5.6 Run `bunx tsc --noEmit` in `.config/opencode/plugins`.
- [ ] 5.7 Smoke-test the live route decision surface after restarting OpenCode if the tool schema changes.
