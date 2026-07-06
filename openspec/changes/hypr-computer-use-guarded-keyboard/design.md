## Context

The plugin now has read-only visibility, target capture, browser target detection, and app approval decisions. macOS Computer Use can click, type, and navigate after Screen Recording, Accessibility, and app approval are granted. Hyprland does not provide a safe universal equivalent to macOS Accessibility, so input control must start narrower.

Keyboard-only execution is the smallest useful side-effecting slice. It is enough to test game workflows and simple keyboard navigation while avoiding pointer coordinates, free-form text entry, clipboard mutation, and menu walking.

## Goals / Non-Goals

**Goals:**

- Send one explicit allowlisted key to one approved Hyprland target.
- Revalidate the target immediately before input.
- Capture before and after evidence around the input attempt.
- Fail closed when approval, target identity, session state, or input backend is unsafe or unavailable.
- Keep backend selection explicit and inspectable.

**Non-Goals:**

- Do not implement pointer movement, clicking, drag/drop, free-form text typing, clipboard paste, menu traversal, or browser page automation.
- Do not automate terminals, OpenCode/Codex, privileged prompts, permission dialogs, lockscreen targets, or sensitive contexts.
- Do not add Nix/system package configuration in this repo.
- Do not add a privileged helper or broad uinput path as a hidden fallback.
- Do not treat app approval as consent for arbitrary future actions.

## Decisions

### Keyboard-only first

The first side-effecting capability should send one discrete key from a fixed allowlist. It should not accept arbitrary strings. Allowed keys should cover game/navigation use first: arrows, Enter, Escape, z, x, and a small set of explicit button keys if needed.

Alternative considered: implement click/type together. That expands the risk surface before target drift, backend safety, and evidence loops are proven.

### Approval must be `approved` or explicit one-turn approval

The app approval evaluator currently returns `ask` for unknown normal apps. The keyboard executor should not interpret `ask` as approval by itself. It must receive an explicit one-turn approval token or equivalent caller intent for the exact target decision.

Alternative considered: let `ask` proceed automatically for testing. That would make the approval layer cosmetic rather than enforceable.

### Revalidate immediately before input

The executor must compare current Hyprland state against the approved target identity immediately before sending a key. Stable ID is preferred, then address/class/title as supporting evidence. Any mismatch is target drift and must reject.

Alternative considered: rely on the target captured during approval. Focus and window state can change between turns; relying on stale metadata is the main failure mode.

### Backend is explicit, no unsafe fallback

The first implementation should support a configured backend only if it can be used knowingly. If no backend is configured or available, return `no-input-backend`. Candidate backends include a compositor-supported virtual keyboard helper, `ydotool`/uinput helper, or another narrowly scoped local command, but none should be assumed.

Alternative considered: shell out to whichever keyboard tool exists. That could silently switch to a privileged/global input path and hit the wrong target.

### Before/after evidence is required

Every successful key attempt must include before and after target metadata and captures when capture is available. Failed attempts should still write rejection evidence.

Alternative considered: capture only after action. The before image is needed to debug wrong-state and wrong-target failures.

## Risks / Trade-offs

- Wayland input injection is global or privileged in many backends -> require exact target revalidation and explicit backend configuration.
- Game windows may be XWayland and focus-sensitive -> start with single-key actions and before/after evidence.
- `ask` decisions are not real approvals -> require explicit one-turn approval before executing.
- Backend setup may live outside dotfiles -> document required external setup instead of adding Nix config here.
- Screenshots are still relatively slow -> use the combined approval/capture path and avoid extra state loops.
