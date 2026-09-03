---
name: docs-cache
description: Use project-local docs-cache references for external documentation and references. Activate when a task mentions docs-cache, docs.config.json, docs-lock.json, .docs, TOC.md, or a Pi @... documentation reference, including reading, citing, restoring, or syncing cached docs.
---

# Docs Cache

## Scope

Use this skill when a task depends on external documentation configured in
`docs.config.json` and cached locally by `docs-cache`.

The Pi integration reads `docs-lock.json` and exposes locked sources as named
references such as `@ags-docs`, `@hyprland-docs`, and `@vicinae-docs`. Pi maps
those aliases to `.docs/<source-id>`. A configured `targetDir` may point
somewhere else, but it is not the path used by Pi's `@` references; follow the
path advertised in `<available_references>`.

## Required Workflow

1. Choose the relevant named reference from the `<available_references>` block.
2. Read that reference's `TOC.md` first when it exists.
3. Search and read the smallest relevant files under the advertised local path.
4. Prefer the cached documentation over an upstream web lookup when it covers
   the question.
5. Include the local reference path, and the relevant document path when
   reporting documentation-based conclusions.

## Synchronization

Treat `.docs/` and `docs-lock.json` as generated state. Never edit them
manually: `docs-cache` can overwrite those changes or leave the cache and
lock metadata inconsistent. Never synchronize them as a side effect of
answering a question.

Choose the command from the user's intent:

- Restore the exact versions recorded in `docs-lock.json`: run
  `npx docs-cache install`.
- Refresh documentation sources and update the lock: run
  `npx docs-cache sync`.

If the relevant cache is missing or incomplete:

1. Run `npx docs-cache install` only when restoration is explicitly requested.
2. Run `npx docs-cache sync` only when a refresh is explicitly requested.
3. Otherwise report the missing or incomplete cache and use an upstream lookup
   only when needed and permitted by the task.

## Boundaries

This skill provides the documentation workflow; it does not duplicate the Pi
reference extension or the `docs-cache` synchronization logic. Pi's aliases
follow `.docs/<source-id>` even when `docs.config.json` defines a custom
`targetDir`. Searching the target directory instead can read an unlinked or
stale copy, so follow the path advertised by Pi.
