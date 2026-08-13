## Context

The current desktop update action launches a dedicated terminal running `flake_update_interactive --rebuild --cache --notify`. Fish owns selection and confirmation, a Bun helper validates cache data, the NixOS update checker writes cache files, and AGS only sees cached badge counts. Once the terminal opens, AGS cannot observe phase, elapsed time, cancellation, failure classification, lockfile restoration, or completion.

The current command runs `nh os switch` or `nixos-rebuild switch`. Build and activation are therefore one runtime operation. The existing design-system `ReadyToActivate` story describes a useful future state but is not reachable from the current implementation.

The change crosses the React design reference, AGS, Fish/Bun helpers, command execution, cache handling, and the separate NixOS configuration repository. Storybook remains a reference contract; AGS must not import React runtime code.

## Goals / Non-Goals

**Goals:**

- Represent the existing flake update workflow as explicit state transitions.
- Keep mutation and recovery behavior at least as safe as the Fish command.
- Let AGS render current state without parsing terminal formatting.
- Preserve reusable terminal UX by making Fish a client of shared update logic rather than deleting it.
- Keep update checking, process output, and badge refresh observable and testable.
- Prevent concurrent update operations.

**Non-Goals:**

- Implement a general package manager or arbitrary flake editor.
- Combine Flatpak installation with the NixOS update transaction.
- Estimate Nix build completion from log volume or derivation count.
- Kill `nix`, `nh`, or `nixos-rebuild` from a close button without a defined cancellation and cleanup protocol.
- Claim active-generation rollback when only `flake.lock` was restored.
- Implement reboot-required detection or post-reboot continuation.
- Make `Activate now` executable while the runtime uses `switch`.

## Decisions

### Use a structured runner as the source of truth

The core workflow will expose structured events and one terminal result. Events include operation identity, phase, step states, elapsed time, optional progress, messages, selected inputs, bounded output, and recovery outcome. AGS and Fish consume that contract; neither infers lifecycle state from decorated stdout.

The event contract should use a discriminated shape with an explicit schema version. Unknown versions fail loudly before mutation. Persisted state stays minimal: enough to restore an active or terminal dialog after AGS reload, not a general transaction database.

Alternative considered: parse existing Fish output. Rejected because spinner text, Gum rendering, and command output are presentation, not a stable API. It would also make restoration failures difficult to distinguish from the original rebuild failure.

### Keep one update operation owner

One runner process owns selection-confirmed mutation, backup lifecycle, rebuild/switch, and result publication. AGS requests operations and observes state; it does not execute individual mutation commands itself. A non-blocking operation lock prevents duplicate checks or updates, and duplicate UI requests reveal the existing operation.

Alternative considered: let AGS spawn each command and manage backup steps. Rejected because a UI process reload could orphan transaction sequencing and because the terminal client would duplicate the same logic.

### Share core execution; keep client-specific interaction

Fish remains responsible for terminal prompts and selection rendering. AGS renders graphical selection and actions. Both call the same structured runner for checks and confirmed mutation/rebuild execution. Existing cache and picker helpers may be reused where their contracts fit, but the runner owns state transitions and terminal classification.

Alternative considered: have AGS invoke `flake_update_interactive`. Rejected because the function expects a TTY and collapses several outcomes into terminal messages and exit codes.

### Preserve the lockfile backup until the transaction is terminal

The runner creates a backup before lockfile mutation and retains it until one of three outcomes:

- Update succeeds without rebuild, or rebuild is explicitly skipped: remove the backup.
- Rebuild/switch succeeds: remove the backup.
- Rebuild/switch fails: restore from backup, verify restoration, then remove the backup only after verified success.

Lockfile update failure is reported separately. The current Fish implementation removes its backup without restoring on this branch, so the UI must not claim restoration unless the new runner performs and verifies it.

Alternative considered: rely on Git to restore `flake.lock`. Rejected because the workflow must work with an intentionally dirty or uncommitted lockfile and restore the exact pre-operation file.

### Use distinct progress semantics by phase

Update checking and flake fetching use an indeterminate bar that moves back and forth. Network request count and transferred bytes do not map to overall update completion, so these phases never show a percentage.

Rebuilding may show an estimate when structured Nix activity events expose completed and total work. The UI prefixes the value with `About` because derivations differ in cost and the total can change during evaluation. The estimate must not use output line count. If structured work events are unavailable, rebuilding falls back to indeterminate progress.

Activation is a separate visible phase within the same `switch` process. When activation begins, rebuild is marked complete and activation active. Activation uses indeterminate progress unless its producer exposes a meaningful denominator.

Alternative considered: show one percentage across checking, rebuilding, and activation. Rejected because the phases have incompatible units and would imply precision the runner does not have.

### Bound visible output and retain full diagnostics

The runner keeps a bounded recent-output buffer for the dialog and writes the complete operation log to a per-operation cache path. Structured events reference that path only after it is created successfully. Output is treated as untrusted text and rendered without markup interpretation.

Alternative considered: retain full output in AGS memory. Rejected because long Nix builds can emit enough output to make the shared AGS process unstable.

### Model cancellation only where recovery is defined

Selection and confirmation are cancellable with no mutation. Checking may be cancellable if terminating the checker has no persistent side effects. Mutation and switch do not expose Cancel until the runner implements signal handling, child-process-group termination, backup restoration, and a tested terminal result. Closing the dialog hides the surface but leaves operation ownership intact.

Alternative considered: always show Cancel and send SIGTERM. Rejected because interruption between lockfile mutation and restoration can leave repository state ambiguous.

### Distinguish activation phase from deferred activation

The current `switch` operation exposes activation as a visible phase after rebuild. This does not make activation separately invokable. The `ReadyToActivate` story remains a future contract for a build-only flow followed by explicit activation. AGS does not expose that action until the runner has separate build and activation commands, persisted closure identity, stale-build invalidation, and failure behavior.

Alternative considered: label the current `switch` confirmation as `Activate now`. Rejected because it hides that the action still evaluates, downloads, and rebuilds first.

### Refresh cache and badge state after terminal outcomes

The runner publishes its primary terminal outcome before requesting a cache refresh. Cache refresh is secondary: its failure is logged and may produce a warning, but cannot turn a successful switch into a failed update. AGS refreshes Start Menu badges only from validated cache data.

Alternative considered: await cache refresh before reporting success. Rejected because checker availability is not part of the system switch transaction.

## Risks / Trade-offs

- Structured runner and clients can drift → version the event schema and validate every event at the boundary.
- AGS reload can lose transient UI state → persist the latest bounded operation snapshot and let the dialog reconnect by operation ID.
- Privilege escalation may require a TTY or graphical authentication → preserve the existing `nh`/`sudo` behavior initially and fail with a clear unavailable-authentication result rather than hanging invisibly.
- Process output can contain control sequences or sensitive paths → strip terminal control sequences for display, render as text, and keep logs user-readable only.
- Rebuild failure can occur after partial activation → report verified lockfile restoration only; do not claim generation rollback or unchanged runtime state unless independently verified.
- A second repository owns the checker service → keep the runner functional with the current cache format and make NixOS producer changes a separately validated task when required.
- Existing terminal users may depend on `nxu` behavior → retain the Fish entry point and migrate it to the shared runner before replacing the desktop launcher.

## Migration Plan

1. Finalize the design-system state contract and Storybook references.
2. Define and test the versioned runner event/result schema with fake command adapters and temporary lockfiles.
3. Implement read-only check and cache states first; keep the current terminal launcher as the desktop fallback.
4. Add AGS dialog registration, visibility API, idle/check/up-to-date/available states, and duplicate-operation prevention.
5. Move confirmed lockfile update and rebuild/switch sequencing behind the runner, including verified restoration tests.
6. Migrate `flake_update_interactive` to consume shared runner outcomes while preserving terminal selection and confirmation behavior.
7. Switch the Start Menu action from the terminal launcher to the AGS dialog after parity checks pass.
8. Retain the terminal launcher as a rollback path for one migration cycle; rollback consists of restoring the Start Menu action without changing cache or update-runner data.

## Open Questions

- Whether privilege escalation should remain terminal-mediated or later use a dedicated polkit action. This can be decided after validating current `nh` behavior from AGS without changing the lifecycle contract.
- Whether the durable operation log should open in the configured terminal or a dedicated log viewer. The spec only requires that full output remain available.
