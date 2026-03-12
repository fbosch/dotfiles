# Migrate OpenCode to Official RTK Plugin

**Status:** accepted
**Date:** 2026-03-12

## Context

This repo previously carried a custom RTK OpenCode plugin package under `.config/opencode/plugins/rtk/` to rewrite `bash` commands through `rtk rewrite`. RTK now ships an upstream-supported OpenCode hook, so continuing to maintain a separate local implementation would duplicate behavior and increase drift risk.

## Decision

Adopt RTK's official OpenCode hook shape at `.config/opencode/plugins/rtk.ts` instead of maintaining a custom plugin package in this repo. Keep the same functional goal - rewriting supported `bash` and `shell` commands through RTK when available - while aligning the implementation with upstream behavior and documentation.

## Alternatives Considered

Keep the custom plugin package under `.config/opencode/plugins/rtk/` and continue maintaining it locally. That preserves full local control, but it duplicates upstream functionality and makes this repo responsible for drift, breakage, and future OpenCode plugin API changes.

Remove RTK integration entirely. That simplifies local config, but it gives up the token and output-shaping benefits the current workflow expects from RTK.

## Consequences

Plugin maintenance shifts toward the upstream-supported implementation, which reduces local code and makes OpenCode behavior track RTK's documented integration more closely. The tradeoff is less local control over hook behavior and release timing, so follow-on work needs to keep docs aligned and verify that exclusions such as `host_exec` still remain outside RTK rewriting.
