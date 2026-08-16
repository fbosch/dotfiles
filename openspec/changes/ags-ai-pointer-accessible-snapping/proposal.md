## Why

Stroke bounds are predictable but often include excess desktop context around one visible control. The installed AT-SPI runtime can identify that control locally and provide tighter bounds without sending accessibility data to an AI provider.

## What Changes

- Query the active application's accessibility tree only after an explicit AI Pointer gesture.
- Isolate synchronous AT-SPI calls in a bounded helper process.
- Automatically replace stroke-derived bounds only for one high-confidence accessible candidate.
- Keep the stroke bounds when accessibility is unavailable, ambiguous, stale, or geometrically inconsistent.
- Show the chosen accessible role and name locally without adding them to provider payloads.

## Capabilities

### New Capabilities

- `ags-ai-pointer-accessible-snapping`: bounded, local semantic target lookup and automatic high-confidence capture snapping.

### Modified Capabilities

- None.

## Impact

- `.config/ags/components/ai-pointer/`: accessibility helper, matching policy, controller integration, preview metadata, and tests.
- `/home/fbb/nixos/modules/desktop/hyprland.nix`: existing AT-SPI and typelib exposure remains the runtime prerequisite.
