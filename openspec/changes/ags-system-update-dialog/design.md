## Context

The current desktop update action launches a terminal running `flake_update_interactive --rebuild --cache --notify`. Fish owns selection and confirmation, a Bun helper validates cache data, the NixOS update checker writes cache files, and AGS sees only cached badge counts. Once the terminal opens, AGS cannot observe phase, elapsed time, cancellation, failure classification, lockfile restoration, or completion.

The current Fish command mutates `flake.lock` in place and then runs `nh os switch` or `nixos-rebuild switch`. The update checker already demonstrates a safer read-only pattern: it passes the current lockfile through `--reference-lock-file` and writes resolved updates to a separate `--output-lock-file`. The new transaction extends that candidate-lock pattern to selected updates, then separates unprivileged build from explicitly confirmed privileged activation.

The change crosses the React design reference, AGS, Fish/Bun helpers, user systemd services, cache handling, and the separate NixOS configuration repository. Storybook remains a reference contract; AGS must not import React runtime code.

## Goals / Non-Goals

**Goals:**

- Represent check, selected-input update, build, pending activation, activation, success, and recovery as explicit state transitions.
- Keep the authoritative flake target consistent across the checker, candidate update, and build.
- Avoid changing the real lockfile until selected-input resolution succeeds.
- Build without privilege, then activate the exact retained closure only after explicit confirmation and graphical authentication.
- Let AGS render current state without parsing terminal formatting.
- Preserve reusable terminal UX by making Fish a client of shared update logic rather than deleting it.
- Keep update checking, process output, timer state, pending activation, and Start Menu state observable and testable.
- Prevent concurrent checks and update transactions from racing cache or lockfile publication.
- Restore only guarantees the runner can verify, and block new mutation when repository recovery is uncertain.

**Non-Goals:**

- Implement a general package manager or arbitrary flake editor.
- Combine Flatpak installation with the NixOS transaction. The checker may retain Flatpak cache refresh as an independent side effect.
- Estimate build completion from log volume, derivation count, or decorated `nh` output.
- Cancel lockfile replacement, build, or activation after those phases start.
- Claim active-generation rollback when only `flake.lock` was restored.
- Automatically roll back the active generation after partial activation.
- Implement reboot-required detection or post-reboot continuation.
- Handle passwords in AGS, Fish, Bun, or the runner.

## Decisions

### Use a user-systemd runner and versioned durable state

A user-systemd service owns update transactions independently of AGS. AGS invokes a small runner CLI that submits commands through operation command files. Commands are discriminated operations with explicit source-state preconditions and expected operation/state identities, so stale or replayed commands cannot act on a newer transaction. The service writes one atomic, versioned state file and the latest complete transaction log; AGS watches the state file through filesystem events instead of polling.

State uses a discriminated schema with explicit operation identity, schema version, phase, step states, monotonic elapsed time, selected and resolved inputs, bounded output, canonical result path, generation metadata, cache warnings, and recovery outcome. Unknown versions fail before mutation. Caches and proven pre-mutation idle state are disposable and invalidated rather than supported through compatibility readers. Unknown pending, mutating, or recovery state is preserved under a non-destructive compatibility block until a supported runner can classify it.

Alternative considered: AGS-owned child processes. Rejected because AGS reloads and dialog closes must not orphan build sequencing or pending activation.

Alternative considered: a custom D-Bus daemon. Rejected because command files plus atomic state and filesystem events provide the required lifecycle with less continuously running infrastructure.

### Use `NH_OS_FLAKE` as the single flake target

Checks, candidate-lock generation, backups, and builds resolve the flake exclusively from `NH_OS_FLAKE`. User-systemd units receive the same value through declared environment. A missing path, unresolved path, or missing `flake.lock` is a clear precondition failure; the workflow does not fall back to `~/nixos`.

This keeps `nh` host and flake environment behavior authoritative. The runner requires `nh` for builds and does not fall back to a second host-resolution path.

### Keep one transaction owner and coordinate all checks

One non-blocking operation lock covers scheduled checks, manual checks, selected-input mutation, build, pending activation, and activation. Duplicate dialog requests reveal the current operation instead of starting another.

Manual checks run the same packaged checker command under the runner so the dialog can receive live state and cancel its process group. If the timer-owned `flake-update-checker.service` is running, a manual check stops it through `systemctl --user stop` and replaces it. A scheduled check that encounters an active transaction exits successfully without changing either cache. A user-initiated update cancels an in-progress background refresh and proceeds from the displayed cache only when its complete lock fingerprint still matches.

### Publish only complete checks

The checker classifies every root input as directly checkable, covered by a followed target, or intentionally non-updateable because it has no revision-bearing upstream. Any root input that cannot be classified fails the check. A failure or timeout for any directly checkable input is a whole-check failure. The checker never publishes a partial Nix cache or turns failed checks into `No updates available`. Candidate results remain private until every required input succeeds, then one versioned cache is atomically published with its checked and excluded input sets.

The cache records a complete fingerprint of the exact source `flake.lock`, schema version, result timestamp, and update list. Cache age controls the stale label and automatic refresh behavior, but any schema-valid cache with an exact fingerprint remains selectable. A changed fingerprint triggers an automatic fresh check before mutation.

When the dialog opens, it shows a matching cache immediately. A stale cache remains visible while an automatic refresh runs. If refresh fails, the matching cache remains usable with a compact warning and no extra stale-data confirmation. If no valid cache exists, opening starts a manual check automatically. Selection is preserved for inputs still present when refreshed results arrive, new inputs default to selected, and vanished inputs are removed.

Flatpak refresh remains a checker side effect but is not part of this dialog's contract. Flatpak failure cannot block publication of a valid Nix cache or turn a Nix check into failure.

### Generate a candidate lockfile before atomic replacement

The update action itself is confirmation. It is disabled for an empty selection, and the runner independently rejects empty input lists.

For one confirmed transaction, the runner:

1. Revalidates the displayed cache fingerprint against the current lockfile.
2. Rejects a symlinked `flake.lock`, stores the exact regular file as a durable backup, and fsyncs the backup and its parent directory.
3. Runs one selected-input `nix flake update` using the current file as `--reference-lock-file` and a same-filesystem temporary file as `--output-lock-file`.
4. Validates the complete candidate lockfile.
5. Reports the actual resolved revisions, which may be newer than the displayed cached candidates.
6. Durably records replacement intent, backup identity, and the candidate fingerprint before mutation.
7. Atomically replaces `flake.lock` with the candidate, fsyncs the target directory, and records replacement completion.
8. Starts the build automatically, even when the candidate is byte-identical to the original lockfile.

A candidate-resolution failure discards the candidate and verifies that the real lockfile remains unchanged. Because candidate generation cannot write the real lockfile, a mismatch at this point is treated as an external-change conflict and is never overwritten automatically.

Alternative considered: update the real lockfile in place and copy it back on command failure. Rejected because the candidate path avoids exposing partial writes and makes the publication boundary explicit.

### Build automatically and pause before activation

After atomic lockfile replacement, the runner executes `nh os build --out-link <operation-owned-result>`. `NH_OS_FLAKE` and `nh` determine the flake and host. Build progress is indeterminate; the runner does not parse `nh` or nix-output-monitor terminal rendering into percentages.

On build success, the runner resolves the result link once to a canonical `/nix/store/...` system closure, validates the expected NixOS closure files, and persists that immutable path. The result link remains only as a GC root. Ready to activate survives dialog close, AGS reload, logout, reboot, and runner restart. The dialog shows both the currently active generation and pending NixOS version/build time; the canonical store path remains in Technical details. Configuration or lockfile changes after the build do not invalidate this exact retained closure. `Activate later` closes the dialog without discarding it.

Starting another update while a pending build exists requires explicit discard. Discard removes the result link and transaction backup but keeps the updated lockfile. The old immutable closure then becomes eligible for normal garbage collection.

### Activate the exact retained closure through polkit

`Activate now` is an explicit second confirmation. The runner activates exactly the retained result with:

`nixos-rebuild switch --store-path <canonical-store-path> --elevate=run0`

Immediately before elevation, the runner verifies that the result link still resolves to the persisted canonical path and that the canonical closure remains valid. It passes the immutable path, not the mutable result-link path, to `nixos-rebuild`. This registers the new generation, activates it, and makes it the boot default without reevaluating or rebuilding. The NixOS configuration installs and autostarts `hyprpolkitagent`; polkit owns graphical authentication, and update code never receives the password.

Cancelling, denying, or failing authentication before activation starts leaves the operation Ready to activate with an inline authentication error. Missing `nixos-rebuild`, unavailable run0/polkit, or failure to launch activation also leaves the retained build ready for a later attempt. The workflow does not fall back to a different privileged command.

The activation adapter records an authoritative started marker before privileged profile registration or activation. Authentication cancellation and launch failure occur before that marker. Once activation starts, Escape and the title-bar close action are disabled until success or failure. Activation is indeterminate. If a failure cannot be classified relative to the marker, the runner uses a blocking indeterminate-recovery state instead of assuming authentication-only failure or started activation. A confirmed started-activation failure warns that live services may be partially changed and does not attempt automatic generation rollback.

### Restore and verify after update, build, or started-activation failure

The backup remains until activation succeeds, the pending build is explicitly discarded, or failure recovery completes.

- Candidate update failure: discard the candidate; an unexpected real-lock mismatch is an external-change conflict and is not restored automatically.
- Build failure: when the current lockfile still matches the transaction's published fingerprint, restore and byte-verify the pre-transaction lockfile, then remove the pending result link.
- Authentication cancellation or pre-activation launch failure: preserve the updated lockfile, backup, and pending result.
- Activation failure after activation starts: when the current lockfile still matches the transaction's published fingerprint, restore and byte-verify the pre-transaction lockfile, remove the result link, and warn that runtime state may be partially changed.
- Activation success: remove the backup and publish the new generation.

After verified restoration, Retry repeats the full transaction: validate or refresh results, generate a new candidate, replace, rebuild, and request activation again. Retry is never automatic.

All supported update clients share the operation lock. Before every automatic restoration, the runner performs a final comparison between the current lockfile and the exact candidate it published. If an external change is visible at that guarded publication boundary, it does not overwrite that work. It preserves the backup and complete log and enters the same blocking recovery-conflict state as a failed restoration. Non-cooperating writers are outside the lock protocol; the guarantee covers changes visible at the final comparison rather than an impossible content-based compare-and-swap against arbitrary concurrent renames.

If restoration fails or an external-change conflict prevents restoration, the runner preserves the backup and complete log, blocks Retry and all new mutations, and persists an unsafe-recovery state across dialog closes and restarts. The block clears only when `flake.lock` byte-for-byte matches the retained backup.

### Define interruption recovery around transaction boundaries

The service does not inhibit logout or reboot. A write-ahead phase marker is durably published before lock replacement, activation start, restoration, and cleanup so restart can classify each boundary. If the session ends during candidate update or build, the next start verifies that no child process remains and that the lockfile parses. If the real lockfile had been replaced before build success, startup applies the same final candidate-fingerprint guard before restoring and verifying the backup. It otherwise discards incomplete operation state and starts over silently.

A completed Ready to activate checkpoint is not treated as interrupted; it remains durable until activation or explicit discard. Interrupted authentication before the started marker returns to Ready to activate. Confirmed started-activation interruption follows activation-failure recovery and retains the partial-live-state warning. Interrupted restoration resumes or verifies restoration from the write-ahead marker without deleting the backup. If activation start is indeterminate, the runner cannot prove that no previous process remains, the lockfile is invalid, or restoration fails, it reports a blocking interrupted/unsafe state rather than guessing.

### Keep complete diagnostics but one retained history entry

The runner keeps bounded recent output in the state file and writes the complete transaction log across check, candidate update, build, authentication, activation, and restoration. A configured safety ceiling bounds one operation's log; reaching it terminates the emitting command and enters normal failure recovery, so the retained log remains complete through termination instead of being silently truncated. A log or state write failure before mutation fails safely; after mutation it stops the child and enters recovery using the already-durable journal and backup. `Copy output` copies the complete transaction text and does not toggle the disclosure. Technical details are collapsed by default and open automatically only for failures and unsafe recovery.

Files are user-readable only, control sequences are neutralized for display, and AGS renders output as text rather than markup. After a terminal result, only the latest operation log and metadata are retained. Closing success or a safely restored failure clears its dialog operation state while retaining that log until the next transaction.

### Integrate automatic checks with the existing timer

The automatic-check checkbox reflects the actual `flake-update-checker.timer` state. Enabling runs the user-systemd enable/start operation; disabling stops and disables future scheduled checks. Manual Check again remains available either way. A failed timer change reverts the checkbox and reports the systemd error.

The existing timer schedule remains authoritative. This change does not duplicate its hourly policy in the dialog.

### Refresh cache and desktop state asynchronously

Successful activation is published immediately with the new generation number/date from `nixos-rebuild list-generations --json`. Generation lookup failure displays Unknown generation and does not block the workflow.

After success, the runner requests one asynchronous cache refresh. Refresh failure is a warning and cannot rewrite activation success. The no-update result remains visible until dismissed rather than auto-closing.

Desktop notifications are emitted for hidden Ready to activate, terminal failure, unsafe recovery, and activation success states; visible dialogs suppress duplicate notifications. The Start Menu entry shows the current phase during work, Ready to activate for a pending closure, and Update failed until a hidden recoverable failure is opened or dismissed. Otherwise it shows validated Nix cache state. The dialog and Start Menu do not combine Flatpak counts into this workflow.

## Risks / Trade-offs

- A split build/activation flow retains a GC root longer than the current command. Explicit discard and terminal cleanup bound that lifetime.
- Activating an exact retained closure after source files change means the active system may not match the current working tree. The UI shows immutable pending-build identity and activates only that closure.
- `run0` depends on polkit and a graphical agent. The configuration adds `hyprpolkitagent`, and pre-activation failures preserve Ready to activate instead of changing auth mechanisms.
- User-systemd state and command files are filesystem APIs. Version schemas, write atomically, set user-only permissions, journal mutation boundaries, and preserve unknown transactional state.
- Non-cooperating external writers cannot participate in a true content compare-and-swap. Recovery never overwrites changes visible at its final guarded comparison; repository tooling should use the shared lock when available.
- Cancelling and replacing a timer check intentionally wastes partial network work. It gives explicit user checks priority and avoids waiting behind a background process.
- Keeping stale but fingerprint-matching results permits revisions to advance between check and mutation. The transaction reports actual resolved revisions and treats the confirmed input names, not cached revision values, as scope.
- Existing terminal users may depend on `nxu` behavior. Retain the Fish entry point and migrate it to the shared runner before replacing the desktop launcher.

## Migration Plan

1. Update the design-system state contract and Storybook references for split build/activation, pending state, completion, restoration failure, zero selection, and hidden-operation semantics.
2. Version the cache schema, add complete lock fingerprints, all-or-nothing Nix checking, atomic publication, and shared checker locking in the NixOS module.
3. Add `hyprpolkitagent`, declare `NH_OS_FLAKE` for user services, and add the user-systemd runner unit.
4. Define and test runner command, state, result, cache, and error schemas with fake process adapters and temporary same-filesystem lockfiles.
5. Implement read-only cache/open/check/cancel states and timer enable/disable behavior while retaining the terminal desktop launcher.
6. Implement candidate-lock generation, atomic replacement, automatic `nh os build`, durable Ready to activate, discard, and interruption recovery.
7. Implement exact-store activation through `nixos-rebuild ... --elevate=run0`, authentication classification, verified restoration, unsafe recovery, and generation refresh.
8. Add AGS dialog registration, filesystem-event subscriptions, focus behavior, accessibility, notifications, and Start Menu operation states.
9. Migrate `flake_update_interactive` to the shared runner while preserving terminal selection and rendering. During one migration cycle, accept `--rebuild` and `--cache` as deprecated no-ops, keep `--force` and `--notify`, and reject positional targets that differ from `NH_OS_FLAKE`; remove the no-op flags after the terminal desktop fallback is retired.
10. Switch the Start Menu action from the terminal launcher to the AGS dialog after parity and recovery checks pass.

## Open Questions

- None blocking. Implementation may choose the operation-state directory, log safety ceiling, and bounded-output size as internal details, provided paths remain user-only, mutation journaling remains crash-durable, and only the latest completed log is retained.
