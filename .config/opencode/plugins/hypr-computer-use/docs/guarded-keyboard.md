# Guarded Keyboard

`mode: "keyboard"` is the first side-effecting `hypr-computer-use` slice. It sends only explicit keys, chords, or short key sequences to one approved Hyprland target.

It is not a text-entry API. Use structured app, browser, shell, or file tools for content changes whenever possible.

## Input Model

| Field | Meaning |
| --- | --- |
| `key` | One explicit key, such as `ArrowUp`, `Enter`, `Escape`, `z`, `F5`, `Space`, or `Tab`. |
| `chord` | One explicit chord, such as `Ctrl+S` or `Alt+Enter`. |
| `sequence` | A short ordered list of explicit keys/chords. Maximum length is 8. |
| `text` | Always rejected with `text-input-unsupported`. |

Exactly one of `key`, `chord`, or `sequence` must be supplied. Unsupported keys or modifiers reject before Hyprland state or backend commands are touched.

Before trying a key for an app workflow, check cached controls with `mode: "controls-cache"` or inspect the `controls` field returned by `mode: "app-approval"`.

## Approval Gate

Keyboard execution uses the same app approval evaluator as `mode: "app-approval"`.

- `ask` does not execute by itself.
- The caller must provide `approvedTarget` for the exact target identity from the approval result.
- `denied` and `sensitive` states reject before backend invocation.
- Terminal GUIs, OpenCode/Codex/tool-permission windows, privileged prompts, and browser page interaction stay blocked.

Example one-turn approval shape:

```json
{
  "stableId": "stable-game",
  "address": "999",
  "class": "steam_app_default",
  "title": "infinitefusion",
  "workspace": { "id": 2, "name": "2" },
  "monitor": 0,
  "monitorName": "DP-1"
}
```

## Target Revalidation

After approval, the plugin captures before evidence, reads Hyprland state again, and finds the approved target in the current Hyprland clients list. Native Wayland targets do not need to be the active or focused window. XWayland targets are focused explicitly before key-state input is sent.

The revalidated target must still match:

- stable ID when available
- address when stable ID is unavailable
- class
- title
- workspace ID/name
- monitor ID/name

Any mismatch rejects with `target-drift` before input is sent. XWayland targets are focused through Hyprland first, then rechecked as the active Hyprland client before input is sent.

## Backend

Native Wayland targets use Hyprland targeted dispatch:

```text
hyprctl dispatch 'hl.dsp.send_shortcut({ mods = "...", key = "...", window = "stableid:<id>" })'
```

The selector prefers `stableid:<stableId>` and falls back to `address:0x<address>` only when no stable ID exists.

XWayland targets use a focused Hyprland key-state path. The plugin focuses the approved Hyprland target with `hl.dsp.focus({ window = "stableid:<id>" })`, verifies that the active Hyprland client still matches the approval, then sends each explicit key/chord as `hl.dsp.send_key_state(..., state = "down")` followed by `state = "up"`. If focus or key-state dispatch fails, the request rejects with `no-input-backend`.

There is no fallback to `xdotool`, `ydotool`, `dotool`, `evemu`, libei, clipboard paste, or unverified focused-window typing.

## Keyboard Plans

`mode: "keyboard-plan"` runs a bounded list of guarded keyboard steps against the same approved target. Each step accepts `action`, one of `key`/`chord`/`sequence`, and optional `waitMs` from 0 to 5000. Plans support 1-100 steps.

Every step uses the same approval, target revalidation, before-capture, dispatch, optional wait, and after-capture flow as `mode: "keyboard"`. The plan stops on the first rejected step and records the failure evidence.

## Evidence

Successful keyboard evidence records include:

- approval decision
- target identity
- input description
- backend and selector
- before/after capture metadata
- dispatched strokes

Rejected attempts include the rejection reason and requested input in error details. Evidence records store screenshot paths and metadata, not inline image bytes.
