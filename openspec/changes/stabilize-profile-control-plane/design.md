## Context

See `proposal.md` for motivation and `specs/profile-control-plane/spec.md` for the behavior contract. `profilectl.sh` currently owns source counts, profile application, rollback, and several cross-feature actuators. Its count files and overlay markers are also read directly by AGS and LuaJIT consumers. The recent fixture work has added coverage for restore, publication, manual-write, and rollback failures, but manual intent remains encoded as counted sources.

The design must retain the existing architecture: `autostart.lua` remains the startup registry, UWSM remains the session lifecycle owner, LuaJIT remains the preferred long-lived Hyprland-aware runtime, and feature-specific supervisors remain feature-specific.

## Goals / Non-Goals

**Goals:**

- Separate manual user intent from automatic source claims.
- Give profilectl one authoritative policy and state-publication boundary.
- Let every consumer read one atomic, versioned state contract.
- Preserve automatic-source updates while a manual override is selected.
- Make incomplete transitions visible and recoverable through `reconcile`.
- Remove profilectl knowledge of Window Capture process names and Window Switcher implementation details.

**Non-Goals:**

- Adding a persistent profile daemon, D-Bus service, or generic desktop control plane.
- Replacing UWSM, daemon supervisors, or the gaming watchdog.
- Rewriting all profile logic into LuaJIT in this change.
- Persisting profile state across desktop sessions.
- Changing gaming workspace, process-freezing, or presentation policy except where canonical profile state requires an existing consumer to respect a manual override.

## Decisions

### Profilectl owns policy; source claims remain inputs

`profilectl` remains the only writer and arbiter. It stores manual selection as one enum and automatic claims by profile/source. Source producers set exact counts, not incremental ownership references. This keeps the watchdog's current reconciliation model idempotent and makes a future automatic Powersave producer straightforward.

When selection is Auto, automatic resolution preserves current Gaming-over-Powersave precedence. When selection is Gaming or Powersave, that selection resolves the profile regardless of claims. Automatic claims are still updated and immediately take effect when selection returns to Auto.

Alternative considered: keep `manual` as a special source with higher numeric priority. Rejected because it preserves the current ambiguity and requires consumers to know a source-level policy rule.

### One atomic public state document represents one logical generation

Profilectl publishes `$XDG_RUNTIME_DIR/hypr-profiles/state.json` through a same-directory temporary file and rename. Version 1 contains:

```json
{
  "version": 1,
  "generation": 42,
  "selection": "auto",
  "resolved": "gaming",
  "applied": "gaming",
  "phase": "converged",
  "sources": {
    "gaming": { "watchdog": 1 },
    "powersave": {}
  },
  "degraded": []
}
```

`phase` is `pending`, `converged`, or `rollback-failed`. `resolved` is policy output; `applied` is the last confirmed core Hyprland profile. Optional side-effect failures are recorded in `degraded` rather than claiming every actuator converged.

Alternative considered: retain one file per source and derive a JSON view in every consumer. Rejected because it preserves torn reads and distributed policy logic.

### State publication cannot make external actuators atomic

Profilectl serializes a transition under its existing lock:

1. Read and validate the prior snapshot and requested input.
2. Publish new intent with `phase: pending`.
3. Perform bounded core Hyprland transition and rollback as necessary.
4. Publish `converged` with confirmed `applied`, or `rollback-failed` with recovery evidence.
5. Retry non-converged state through `reconcile`.

Power profile selection and UI presentation are optional side effects unless later explicitly promoted to core behavior. They receive bounded attempts and appear in `degraded` on failure. User-success output occurs only after core convergence.

Alternative considered: publish only after actuation. Rejected because process death after successful actuation would leave no recovery intent. Publishing only before actuation was rejected because consumers would overclaim applied state.

### Consumers are passive adapters

AGS gets one `profile-state` service that monitors the parent directory, parses complete snapshots, and exposes derived bindings. Gaming opacity, Start Menu, and Window Switcher consume that service. Lua consumers use one small profile-state reader. The custom-layout daemon reads applied profile state through that reader rather than the overlay marker path.

Window Switcher derives icons versus previews from applied profile state. Profilectl no longer sends a Window Switcher-specific AGS request. AGS still owns rendering and request routing.

Alternative considered: a new Unix socket for profile state. Rejected because filesystem monitoring already supports passive, restart-safe consumers and no request/response interaction is needed.

### Actuator boundaries use feature interfaces

Profilectl continues applying Hyprland profiles and selecting power profiles directly because those are profile actuators. Window Capture exposes a small feature-level pause, resume, refresh, and status interface; profilectl invokes it without process-name matching or daemon filename knowledge.

The gaming watchdog remains owner of game detection, game workspace behavior, freezing, and presentation selection. It updates only its source claim. If its presentation would conflict with a manually applied non-Gaming profile, it consumes canonical applied state and suppresses presentation updates until Gaming is applied again.

### Compatibility is temporary and one-way

The controller retains the existing CLI commands as compatibility wrappers while callers migrate. Legacy count and marker files become read-only projections from canonical state for one migration release; no legacy writer may mutate policy independently. Every in-repository consumer migrates before the projections are removed.

Because state is session-scoped, a downgrade is either an explicit state export before running older code or an unsupported in-session transition that fails loudly. A newer unknown state version is never reset to Default.

## Risks / Trade-offs

- [Process exit between pending publication and actuation] -> `reconcile` completes or rolls back the pending generation.
- [Process exit after actuation and before convergence publication] -> `reconcile` reapplies the resolved core profile before publishing convergence.
- [Old AGS instance reads legacy files during migration] -> retain read-only projections until AGS consumers are migrated and restart AGS with the new reader.
- [Profile state is malformed or oversized] -> reject it before actuation, preserve the last valid document, and emit a diagnostic.
- [A manual override conflicts with watchdog presentation] -> watchdog continues detecting games but gates profile presentation on canonical applied state.
- [Feature-level capture control changes ownership behavior] -> preserve existing window-capture ownership and worker tests before replacing process matching.

## Migration Plan

1. Expand the production profilectl fixture to fully characterize current source, manual, and actuator behavior.
2. Add transaction phases and canonical state publication while retaining legacy inputs and outputs.
3. Migrate automatic producers and manual callers to the stable CLI; prevent manual changes through generic source commands.
4. Migrate AGS and Lua readers one at a time, then remove imperative Window Switcher updates.
5. Introduce Window Capture feature controls and replace profilectl's process matching.
6. Remove legacy state projections only after all in-repository consumers use the canonical document.
7. Consider a LuaJIT implementation only after the CLI and state contract have remained stable.

Rollback is phase-local: consumers can return to legacy readers until projection removal; the controller keeps its executable path and compatibility commands throughout the migration; capture interfaces retain the current process path as a temporary logged fallback until lifecycle tests prove the new interface.
