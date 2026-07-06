## Context

The plugin now has read-only visibility, target capture, browser target detection, and app approval decisions. macOS Computer Use can click, type, and navigate after Screen Recording, Accessibility, and app approval are granted. Hyprland does not provide a safe universal equivalent to macOS Accessibility, so input control must start narrower.

Keyboard-only execution is the smallest useful side-effecting slice. Hyprland 0.55 provides targeted dispatcher APIs for shortcuts/key state with an optional window selector, which makes a Hyprland-specific keyboard backend more realistic than generic Wayland input injection. This is enough to test game workflows and simple keyboard navigation while avoiding pointer coordinates, free-form text entry, clipboard mutation, and menu walking.

## Goals / Non-Goals

**Goals:**

- Send explicit keys, chords, or short key sequences to one approved Hyprland target.
- Revalidate the target immediately before input.
- Capture before and after evidence around the input attempt.
- Fail closed when approval, target identity, session state, or input backend is unsafe or unavailable.
- Prefer Hyprland targeted dispatchers and keep backend selection explicit and inspectable.

**Non-Goals:**

- Do not implement pointer movement, clicking, drag/drop, free-form text typing, clipboard paste, menu traversal, or browser page automation.
- Do not automate terminals, OpenCode/Codex, privileged prompts, permission dialogs, lockscreen targets, or sensitive contexts.
- Do not add Nix/system package configuration in this repo.
- Do not add a privileged helper or broad uinput path as a hidden fallback.
- Do not treat app approval as consent for arbitrary future actions.

## Decisions

### Keyboard model first

The first side-effecting capability should support explicit keys, chords, and short key sequences. It should not accept arbitrary text strings. This gets closer to macOS Accessibility keyboard control while preserving inspectable intent. Examples: `ArrowUp`, `Enter`, `z`, `Ctrl+S`, or `[ArrowDown, ArrowDown, Enter]`.

Alternative considered: implement click/type together. That expands the risk surface before target drift, backend safety, and evidence loops are proven.

### Hyprland dispatcher is the preferred backend

The preferred backend is Hyprland 0.55 targeted dispatch via `hl.dsp.send_shortcut` and `hl.dsp.send_key_state`. The executor should target a specific window selector, preferring `stableid:<stableId>` and falling back to address only when stable ID is unavailable. Class/title/PID should support revalidation, not primary targeting.

Alternative considered: use `wtype`, `ydotool`, `dotool`, `evemu`, or libei first. These are generally global, focused, privileged, or not clearly target-bound, so they should remain explicit non-default backends unless proven safe.

### Approval must be `approved` or explicit one-turn approval

The app approval evaluator currently returns `ask` for unknown normal apps. The keyboard executor should not interpret `ask` as approval by itself. It must receive an explicit one-turn approval token or equivalent caller intent for the exact target decision.

Alternative considered: let `ask` proceed automatically for testing. That would make the approval layer cosmetic rather than enforceable.

### Revalidate immediately before input

The executor must compare current Hyprland state against the approved target identity immediately before sending a key. Stable ID is preferred, then address/class/title as supporting evidence. Any mismatch is target drift and must reject.

Alternative considered: rely on the target captured during approval. Focus and window state can change between turns; relying on stale metadata is the main failure mode.

### Backend is explicit, no unsafe fallback

The first implementation should use the Hyprland dispatcher backend when available. If that backend cannot represent the requested key/chord/sequence or the dispatch command is unavailable, return `no-input-backend` or a specific unsupported-key result. Generic focused/global input tools must not be used as silent fallbacks.

Alternative considered: shell out to whichever keyboard tool exists. That could silently switch to a privileged/global input path and hit the wrong target.

### Before/after evidence is required

Every successful key attempt must include before and after target metadata and captures when capture is available. Failed attempts should still write rejection evidence.

Alternative considered: capture only after action. The before image is needed to debug wrong-state and wrong-target failures.

## Risks / Trade-offs

- Hyprland dispatcher semantics can differ from macOS Accessibility -> keep this backend Hyprland-specific and evidence-backed.
- XWayland game windows may receive shortcuts inconsistently -> record backend failures and do not silently switch to global input.
- `ask` decisions are not real approvals -> require explicit one-turn approval before executing.
- Generic input backend setup may live outside dotfiles -> document required external setup instead of adding Nix config here.
- Screenshots are still relatively slow -> use the combined approval/capture path and avoid extra state loops.
