## Why

OpenCode can reason over screenshots, but AGS has no safe non-interactive path for sending bounded desktop context to it. A pointer-driven query needs a clear consent boundary, reliable cleanup, and enough compositor context to identify the selected application without putting OpenCode's SDK lifecycle in the GTK process.

## What Changes

- Add a standalone Bun request runtime that submits bounded text and image context to OpenCode through a versioned JSON stdin/stdout protocol.
- Add a hidden, answer-only `desktop-pointer` OpenCode agent with all tools disabled.
- Add an AGS AI Pointer workflow that lets a user drag-select a screen region, review it with its associated application context, type a question, and receive a read-only answer.
- Add direct Hyprland press/release selection and `grim` capture so the workflow retains global selection geometry and can classify a unique exact window geometry separately from geometric window and layer candidates.
- Attach privacy-minimized Hyprland client, layer, monitor, workspace, and active-window context to the selected image.
- Use ephemeral OpenCode sessions, explicit timeout/cancellation cleanup, and private runtime capture storage.
- Do not modify, import from, migrate, or otherwise alter `ai_commit` or its Fish wrapper. It is only an architectural reference.
- Exclude voice, OCR, semantic application adapters, follow-up sessions, multiple targets, and any desktop or file mutation from this change.

## Capabilities

### New Capabilities

- `opencode-request-runtime`: Provides a bounded, non-interactive request boundary around OpenCode server selection, sessions, attachments, cancellation, and normalized responses.
- `ags-ai-pointer-query`: Provides explicit drag selection, compositor-context enrichment, typed questions, and safe read-only answer presentation through AGS and Hyprland.

### Modified Capabilities

- None.

## Impact

- New Bun/TypeScript helper code and a pinned `@opencode-ai/sdk` dependency under `.config/opencode/libexec/`.
- New hidden OpenCode agent under `.config/opencode/agents/`.
- New AGS feature slice, bundled-component registration, styles, Hyprland binding, and layer rule.
- Existing OpenCode tools, AI Commit workflow, Fish functions, and persistent configuration formats remain unchanged.
