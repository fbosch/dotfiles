## Why

OpenCode can reason over screenshots, but AGS has no safe non-interactive path for sending bounded desktop context to it. A pointer-driven query needs a clear consent boundary, reliable cleanup, and enough compositor context to identify the selected application without putting OpenCode's SDK lifecycle in the GTK process.

## What Changes

- Add a standalone Bun answer runtime with a backend-neutral, versioned JSON stdin and streaming NDJSON stdout protocol, plus an initial OpenCode backend.
- Add a hidden, answer-only `desktop-pointer` OpenCode agent with all tools disabled.
- Add an AGS AI Pointer workflow that lets a user draw over a screen region, review the resolved capture with its associated application context, type a question, and receive a read-only answer.
- Add a Hyprland press/release stroke workflow with sampled pointer geometry, bounded click fallback, and direct `grim` capture so the workflow retains the final global capture geometry and can classify a unique exact window separately from geometric window and layer candidates.
- Attach privacy-minimized Hyprland client, layer, monitor, workspace, and active-window context to the selected image.
- Use ephemeral OpenCode sessions, explicit timeout/cancellation cleanup, and private runtime capture storage.
- Do not modify, import from, migrate, or otherwise alter `ai_commit` or its Fish wrapper. It is only an architectural reference.
- Exclude voice, OCR, semantic application adapters, follow-up sessions, multiple targets, and any desktop or file mutation from this change.

## Capabilities

### New Capabilities

- `answer-request-runtime`: Provides a bounded, non-interactive answer boundary that hides backend selection, policy, lifecycle, cancellation, and response normalization from callers.
- `ags-ai-pointer-query`: Provides explicit stroke selection, compositor-context enrichment, typed questions, and safe read-only answer presentation through AGS and Hyprland.

### Modified Capabilities

- None.

## Impact

- New Bun/TypeScript answer runtime with an OpenCode backend and a pinned `@opencode-ai/sdk` dependency under `.config/opencode/libexec/`.
- New hidden OpenCode agent under `.config/opencode/agents/`.
- New AGS feature slice, bundled-component registration, styles, Hyprland binding, and layer rule.
- Existing OpenCode tools, AI Commit workflow, Fish functions, and persistent configuration formats remain unchanged.
