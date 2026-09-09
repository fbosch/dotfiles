---
name: vicinae-extension-authoring
description: Create or update Vicinae extensions in this repo. Use when implementing new extensions, adding commands/preferences, wiring React Query + Vicinae Cache, or standardizing ActionPanel UX/shortcuts, build/lint workflows, and structure to match existing patterns under .config/vicinae/extensions.
---

# Vicinae Extension Authoring

## Overview

Follow the repo’s established Vicinae extension patterns for structure, caching, actions, and build workflow. Prefer the same defaults and shortcut semantics used across existing extensions.

## Workflow

1. Identify scope and complexity (single command vs multi-module extension).
2. Choose structure from `references/extension-template.md`.
3. Define manifest + preferences in `package.json` using the Vicinae schema.
4. Implement data access with React Query persistence using `persistQueryClient` (see `references/cache-patterns.md`).
5. Implement ActionPanel ordering and shortcuts (see `references/action-ux-standards.md`), preferring `Keyboard.Shortcut.Common.*` values before hardcoded key combos.
6. Add empty/loading/error states and toasts.
7. Run `pnpm -C <extension> lint` and `pnpm -C <extension> build`.
8. For dev sessions, run `pnpm -C <extension> dev`.

## Decision points

- Single-file vs modular: use the expanded structure when you have API calls, caching, or >1 command.
- Cache strategy: use Vicinae Cache when data should persist across sessions or is expensive to recompute; otherwise React Query alone is fine.
- TTLs: keep Cache TTL and React Query `staleTime` aligned unless there is a clear reason to diverge.

## Manifest and structure rules

- Match directory name with `package.json` `name`.
- Include `extension_icon.png` (512x512) in `assets/`.
- Include at least one command with `mode: "view"`.
- Use `@vicinae/api` in dependencies.

## Local dev requirements

- NodeJS >= 20 and a npm-compatible package manager (pnpm preferred in this repo).

## Data and cache rules

- Use React Query for fetches and local cache.
- Prefer `persistQueryClient` with a Vicinae Cache-backed persister for cross-session persistence.
- Keep `gcTime` aligned with `persistQueryClient` `maxAge`.
- Do not trigger toasts during render; trigger them from explicit actions, async handlers, or query `onError`.

## Shortcut rules

- Prefer `Keyboard.Shortcut.Common.*` for standard actions so user-customized keybindings are respected.
- Use explicit `{ modifiers, key }` shortcuts only when there is no matching common shortcut (for example: Toggle Detail).
- Use valid common keys only (`Copy`, `CopyName`, `CopyPath`, `CopyDeeplink`, `Open`, `OpenWith`, `Refresh`, `Save`, `New`, `Edit`, `Duplicate`, `MoveUp`, `MoveDown`, `Pin`, `Remove`, `RemoveAll`).
- Only bind shortcuts for actions that are currently available.
- Prefer `Action.*` wrappers (`Action.OpenInBrowser`, `Action.CopyToClipboard`, `Action.RunInTerminal`) before custom `Action` when behavior matches.

## Anti-patterns (never)

- Never call `showToast` during render; it causes repeated toasts and jitter.
- Never leave debug logging in production commands.
- Never mix manual Cache persistence with React Query persistence in the same command.
- Never hardcode a shortcut when an equivalent `Keyboard.Shortcut.Common.*` value exists.
- Never bind shortcuts for actions that are unavailable.
- Never open external URLs without a success toast + `closeMainWindow()`.

## References

**Official Vicinae Documentation**:
- **Introduction & architecture**: `https://docs.vicinae.com/extensions/introduction`
- **Creating extensions**: `https://docs.vicinae.com/extensions/create`
- **File structure**: `https://docs.vicinae.com/extensions/file-structure`
- **Manifest format**: `https://docs.vicinae.com/extensions/manifest`
- **View commands**: `https://docs.vicinae.com/extensions/view-command`
- **No-view commands**: `https://docs.vicinae.com/extensions/no-view-command`
- **Debugging Raycast extensions**: `https://docs.vicinae.com/extensions/debug-raycast`
- **API reference (TypeDoc)**: `https://api-reference.vicinae.com/modules.html`

**Repo-specific patterns**:
- If creating a new extension or adding modules, read `references/extension-template.md`.
- If implementing persistence or caching, read `references/cache-patterns.md` before coding.
- If adding or reordering actions/shortcuts, read `references/action-ux-standards.md`.
