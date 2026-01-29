---
name: vicinae-extension-authoring
description: Create or update Vicinae extensions in this repo. Use when implementing new extensions, adding commands/preferences, wiring React Query + Vicinae Cache, or standardizing ActionPanel UX/shortcuts, build/lint workflows, and structure to match existing patterns under .config/vicinae/extensions.
---

# Vicinae Extension Authoring

## Overview

Follow the repo’s established Vicinae extension patterns for structure, caching, actions, and build workflow. Prefer the same defaults and shortcuts used across existing extensions.

## Workflow

1. Identify scope and complexity (single command vs multi-module extension).
2. Choose structure from `references/extension-template.md`.
3. Define manifest + preferences in `package.json` using the Vicinae schema.
4. Implement data access with React Query persistence using `persistQueryClient` (see `references/cache-patterns.md`).
5. Implement ActionPanel ordering and shortcuts (see `references/action-ux-standards.md`).
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
- Do not trigger toasts during render; use `useEffect` or query `onError`.

## Anti-patterns (never)

- Never call `showToast` during render; it causes repeated toasts and jitter.
- Never leave debug logging in production commands.
- Never mix manual Cache persistence with React Query persistence in the same command.
- Never bind shortcuts for actions that are unavailable.
- Never open external URLs without a success toast + `closeMainWindow()`.

## References

- If creating a new extension or adding modules, read `references/extension-template.md`.
- If implementing persistence or caching, read `references/cache-patterns.md` before coding.
- If adding or reordering actions/shortcuts, read `references/action-ux-standards.md`.
