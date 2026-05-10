# Delete Legacy Hyprland Directory

**Status:** accepted
**Date:** 2026-05-10

## Context

ADR 0007 made the Hyprland Lua configuration primary and moved the old hyprlang graph under `.config/hypr/legacy/` for reference during the final cleanup and regression window. The migration is now complete, so keeping the legacy directory preserves obsolete configuration that no longer represents the active setup.

## Decision

Delete the legacy Hyprland directory and treat the Lua configuration as the only maintained Hyprland configuration path. Historical context remains in the ADRs rather than in a parallel config tree.

## Alternatives Considered

Keeping `.config/hypr/legacy/` was rejected because it extends the migration state after Lua has become the active configuration. Archiving the directory elsewhere in the repo was also rejected because the ADR history is sufficient for explaining why the old layout existed.

## Consequences

The Hyprland config tree becomes smaller and harder to misread, with fewer stale files for agents and humans to inspect. Rollback by reusing the old hyprlang tree becomes harder, but that tradeoff is acceptable now that the Lua setup is adopted.
