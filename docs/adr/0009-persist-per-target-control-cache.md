# Persist Per-Target Control Cache

**Status:** accepted
**Date:** 2026-07-06

## Context

Guarded keyboard input is intentionally narrow, but it still needs app-specific controls to avoid guessing keys against a live window. Infinite Fusion exposed the problem immediately: generic summary-tab guesses did not work, while documented Pokémon Essentials controls identified the right page-switch bindings.

## Decision

Persist discovered controls in the `hypr-computer-use` plugin state cache, keyed by normalized Hyprland window class and title. `controls-cache` can save or look up a target profile, and `app-approval` returns cached controls when a matching target is resolved.

## Alternatives Considered

Keeping controls only in conversation context was rejected because the next session would rediscover the same controls. Keying by stable ID or address was rejected because those identifiers are session-specific. Adding a broader app registry was deferred because the immediate need is a small cache for controls metadata, not a full automation registry.

## Consequences

Future guarded keyboard use can inspect cached controls before sending keys, which lowers the chance of trial-and-error input. The cache can become stale if a user remaps controls, so entries store source and notes and can be overwritten for the same class/title pair.
