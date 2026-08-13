## 1. Design-System Contract

- [x] 1.1 Add `SystemUpdateDialog` with exported props and step-state types.
- [x] 1.2 Reuse design-system `Window` and `Button` primitives with token-based Tailwind styling.
- [x] 1.3 Communicate step status through accessible markers without redundant status badges.
- [x] 1.4 Keep current generation metadata in the header and operation logs in a separate Technical details disclosure.
- [x] 1.5 Add stories for idle check, checking, check failure, rebuilding, activation, lockfile failure, rebuild failure, activation failure, and ready-to-activate reference.
- [x] 1.6 Add interaction assertions for progress semantics, automatic-check preference, primary actions, cancellation, and alerts.
- [x] 1.7 Run targeted Biome checks and a Storybook production build.

## 2. Runner Contract

- [ ] 2.1 Define a versioned structured event and terminal-result schema for operation identity, phase, step state, phase duration, elapsed time, optional progress, selected inputs, output, log path, and recovery outcome.
- [ ] 2.2 Validate runner events at client boundaries and reject unknown schema versions before mutation.
- [ ] 2.3 Add a single-operation lock that returns the active operation identity instead of starting duplicate work.
- [ ] 2.4 Persist a bounded latest-operation snapshot so AGS can reconnect after reload.
- [ ] 2.5 Write complete operation output to a user-readable per-operation log while retaining only bounded recent output in state events.

## 3. Read-Only Update Checking

- [ ] 3.1 Reuse the existing cache validator for schema, freshness, and lock-revision matching.
- [ ] 3.2 Fall back to a fresh check for missing, stale, malformed, inaccessible, or revision-mismatched cache data.
- [ ] 3.3 Report idle, checking, up-to-date, updates-available, cancelled-check, and check-failed terminal states.
- [ ] 3.4 Include input name and current/candidate revisions in the updates-available result.
- [ ] 3.5 Render a back-and-forth indeterminate bar for checking and flake network requests without a percentage.

## 4. Confirmed Lockfile Update

- [ ] 4.1 Accept an explicit non-empty selected-input list and a confirmed mutation request.
- [ ] 4.2 Back up the exact pre-operation `flake.lock` before mutation and keep the backup until a terminal outcome.
- [ ] 4.3 Update only selected inputs and publish lockfile step transitions.
- [ ] 4.4 On lockfile update failure, stop before rebuild, preserve diagnostic output, and avoid unverified restoration claims.
- [ ] 4.5 Treat empty selection or declined confirmation as successful cancellation without mutation.

## 5. Rebuild, Switch, and Recovery

- [ ] 5.1 Run `nh os switch` when available and retain the existing `nixos-rebuild switch` fallback.
- [ ] 5.2 Expose rebuild and activation as separate step states within the same `switch` operation.
- [ ] 5.3 Estimate rebuild percentage from structured Nix work events when available, label it approximate, and fall back to indeterminate progress otherwise.
- [ ] 5.4 Detect activation start from a stable producer signal, mark rebuild complete, and report activation as indeterminate unless a real denominator exists.
- [ ] 5.5 Support explicit rebuild skip after successful lockfile update, leaving the updated lockfile in place.
- [ ] 5.6 On successful switch, remove the backup and publish success before requesting cache refresh.
- [ ] 5.7 On failed switch, restore and verify the previous lockfile before claiming restoration.
- [ ] 5.8 Report restoration failure separately and leave automatic retry disabled.
- [ ] 5.9 Do not expose executable `Activate now` behavior until a separate build and activation path exists.
- [ ] 5.10 Distinguish activation failure from rebuild failure, report possible partial activation, offer explicit Retry and Cancel actions, and never retry automatically.

## 6. Fish Client Migration

- [ ] 6.1 Keep `flake_update_interactive` as the terminal entry point while moving core execution to the structured runner.
- [ ] 6.2 Preserve Fish-owned argument handling, update selection, confirmation, and terminal rendering.
- [ ] 6.3 Map runner outcomes to existing successful, skipped, cancelled, and failed terminal messages without parsing decorated output.
- [ ] 6.4 Preserve `--rebuild`, `--cache`, `--force`, and `--notify` behavior or document an intentional contract change before replacement.

## 7. AGS Dialog

- [ ] 7.1 Add a lazy AGS System Update Dialog that mirrors the design-system contract without importing React or Storybook code.
- [ ] 7.2 Add an AGS adapter that starts runner requests, subscribes to structured state, reconnects by operation ID, and survives backend initialization failure.
- [ ] 7.3 Register `system-update-dialog` in `ags-bundled` with `show`, `hide`, `toggle`, `check`, and `is-visible` requests.
- [ ] 7.4 Render idle, checking, up-to-date, updates-available, updating, rebuilding, success, cancellation, and distinct failure states.
- [ ] 7.5 Render current generation metadata in the header and keep command output exclusively under Technical details.
- [ ] 7.6 Focus or reveal an existing operation instead of starting a duplicate.
- [ ] 7.7 Allow dismissal when no mutation is active; during mutation, hiding the dialog must leave the operation observable and reconnectable.

## 8. Start Menu Integration

- [ ] 8.1 Replace the Start Menu system-update terminal launch with an AGS System Update Dialog show/check request after runner parity is verified.
- [ ] 8.2 Refresh Start Menu badge data from validated cache state after terminal outcomes.
- [ ] 8.3 Keep primary success independent from secondary cache-refresh failure.
- [ ] 8.4 Retain the terminal launcher as a rollback path for one migration cycle.

## 9. Validation

- [ ] 9.1 Add runner tests using temporary lockfiles and fake check/update/switch command adapters.
- [ ] 9.2 Cover up-to-date, updates-available, invalid-cache fallback, check failure, cancellation before mutation, lockfile failure, switch success, switch failure with successful restoration, and restoration failure.
- [ ] 9.3 Verify tests never mutate the live system profile or repository `flake.lock`.
- [ ] 9.4 Verify AGS request handling, duplicate-operation prevention, reload reconnection, bounded output, and backend-unavailable behavior.
- [ ] 9.5 Run targeted Fish/Bun checks, AGS validation, `pnpm build-storybook`, strict OpenSpec validation, and `stow -n .`.
