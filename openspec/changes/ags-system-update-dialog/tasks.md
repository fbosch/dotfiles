## 1. Design-System Contract

- [x] 1.1 Add `SystemUpdateDialog` with exported props and step-state types.
- [x] 1.2 Reuse design-system `Window`, `Button`, and `ProgressBar` primitives with token-based Tailwind styling.
- [x] 1.3 Communicate step status through accessible markers without redundant status badges.
- [x] 1.4 Keep current generation metadata in the header and operation logs in a separate Technical details disclosure.
- [ ] 1.5 Replace the permissive prop bag with a lifecycle model that cannot expose invalid actions such as mutation Cancel or activation before build success.
- [ ] 1.6 Update stories for cached refresh warnings, zero selection, candidate update, indeterminate build, Ready to activate, authentication error, activation, successful completion, interruption, and unsafe restoration failure.
- [ ] 1.7 Add interaction assertions for selection reconciliation, disabled empty submission, disclosure/copy behavior, dismissal rules, Escape, focus containment/restoration, and activation close lockout.
- [ ] 1.8 Run targeted Biome checks, accessibility interactions where available, and a Storybook production build.

## 2. Versioned Runner Contract

- [ ] 2.1 Define versioned discriminated commands for check, cancel-check, update/build, activate, discard-pending, retry, and timer changes, including expected operation/state identity, valid source states, and idempotent replay behavior.
- [ ] 2.2 Define versioned state, terminal-result, cache, and machine-error schemas for operation identity, lifecycle phase, step state, elapsed time, selected/resolved inputs, bounded output, log path, canonical result path, generation metadata, warnings, and recovery outcome.
- [ ] 2.3 Reject malformed commands, unsafe paths, stale operation identities, and unknown schema versions before mutation; preserve unknown transactional state under a non-destructive compatibility block.
- [ ] 2.4 Add a small runner CLI that submits atomic command files to a user-systemd-owned operation service.
- [ ] 2.5 Persist one atomic latest-operation state file and subscribe from AGS through filesystem events rather than polling.
- [ ] 2.6 Journal and fsync mutation intent, backup identity, replacement, activation start, restoration, and cleanup boundaries before their side effects.
- [ ] 2.7 Write the complete transaction log with user-only permissions and a safety ceiling, fail safely on log/state write errors, expose bounded recent output, neutralize control sequences, and retain only the latest completed log.
- [ ] 2.8 Add one non-blocking lock shared by scheduled checks, manual checks, update/build, pending activation, and activation.
- [ ] 2.9 Resolve all check/update/build targets exclusively from declared `NH_OS_FLAKE` and fail clearly when it is missing or invalid.

## 3. Checker and Cache Integration

- [ ] 3.1 Version the Nix update cache and include a complete fingerprint of the exact source `flake.lock`; invalidate unversioned caches without a compatibility reader.
- [ ] 3.2 Classify every root input as directly checkable, covered by a followed target, or intentionally non-updateable; reject unknown classifications and make any required check failure/timeout prevent cache publication.
- [ ] 3.3 Publish candidate Nix cache data atomically only after complete success while retaining Flatpak refresh as an independent non-blocking side effect.
- [ ] 3.4 Show any schema-valid exact-fingerprint cache immediately; use age only for stale labeling and automatic refresh behavior.
- [ ] 3.5 Start a manual check automatically when no valid cache exists and refresh stale visible cache in the background.
- [ ] 3.6 Preserve matching input selections across refreshed results, select newly discovered inputs, and remove vanished inputs.
- [ ] 3.7 Keep matching cached results usable with a compact warning when refresh fails.
- [ ] 3.8 Run manual checks under the runner with process-group cancellation; stop and replace a timer-owned checker service when requested.
- [ ] 3.9 Keep the previous valid cache after check cancellation and make scheduled checks skip successfully without cache changes while a transaction owns the lock.
- [ ] 3.10 Cancel a background refresh when Update is submitted, then revalidate the exact lock fingerprint before mutation; automatically refresh instead of mutating if it changed.

## 4. Candidate Lockfile Transaction

- [ ] 4.1 Treat `Update N selected inputs` as confirmation, disable it for empty selection, and reject empty input lists in the runner.
- [ ] 4.2 Reject symlinked lockfiles and save/fsync the exact regular pre-transaction `flake.lock` and backup directory before candidate generation.
- [ ] 4.3 Generate one same-filesystem candidate with selected inputs, `--reference-lock-file`, and `--output-lock-file` without modifying the real lockfile.
- [ ] 4.4 Validate the complete candidate, report actual transaction-time revisions, durably record replacement intent and fingerprint, atomically replace `flake.lock`, and fsync the target directory before recording completion.
- [ ] 4.5 Start the build even when the validated candidate is byte-identical to the original lockfile.
- [ ] 4.6 On candidate failure, discard it and verify the real lockfile remained unchanged; if it changed externally, preserve it and enter blocking recovery conflict instead of overwriting it.

## 5. Build and Pending Activation

- [ ] 5.1 Require `nh` and run `nh os build --out-link <operation-result>` using the service's `NH_OS_FLAKE`/host environment.
- [ ] 5.2 Report build progress as indeterminate and keep decorated command output in Technical details rather than parsing percentages.
- [ ] 5.3 After build failure, restore and byte-verify the pre-transaction lockfile only when the current file still matches the published candidate; otherwise preserve the external change and enter blocking recovery conflict.
- [ ] 5.4 Resolve and validate the successful result link to a canonical immutable NixOS store closure, persist that path while retaining the link only as a GC root, and preserve Ready to activate across dialog close, AGS reload, logout, reboot, and runner restart.
- [ ] 5.5 Show current generation plus pending NixOS version/build time; keep the full store path in Technical details.
- [ ] 5.6 Implement `Activate later` as dismissal that preserves the pending result.
- [ ] 5.7 Require explicit discard before replacing a pending build; discard removes the result link and transaction backup but keeps the updated lockfile.
- [ ] 5.8 Activate the exact retained closure even when the working tree or lockfile changes after build success.

## 6. Polkit Activation and Recovery

- [ ] 6.1 Add and autostart `hyprpolkitagent` in the NixOS/Hyprland configuration.
- [ ] 6.2 Revalidate result-link identity and closure shape, then run `nixos-rebuild switch --store-path <canonical-store-path> --elevate=run0` only after explicit `Activate now` confirmation.
- [ ] 6.3 Keep Ready to activate after authentication cancellation/denial, unavailable polkit/run0, missing activation command, or failure before activation starts.
- [ ] 6.4 Define and persist an authoritative activation-start marker; disable Escape/Close after it, report activation as indeterminate, and use blocking indeterminate recovery when failure cannot be classified around the marker.
- [ ] 6.5 On activation success, remove the backup, clear the pending result, and publish the new boot-default generation from `nixos-rebuild list-generations --json`.
- [ ] 6.6 On activation failure after start, warn about possible partial live-system changes, restore and byte-verify the backup only when the lockfile still matches the published candidate, remove the result link after recovery, and do not roll back the generation automatically.
- [ ] 6.7 After verified restoration, make Retry repeat the full selected-input update/build/activation transaction; never retry automatically.
- [ ] 6.8 If restoration fails or an external lockfile change prevents safe restoration, preserve the backup and log, block all new mutations, and keep unsafe recovery visible until `flake.lock` byte-for-byte matches the backup.
- [ ] 6.9 Keep generation lookup informative rather than blocking; display Unknown generation when structured lookup fails.

## 7. Interruption and Lifecycle Handling

- [ ] 7.1 On service start, read the write-ahead phase marker, verify no prior child process survives, and validate `flake.lock` before discarding incomplete operation state.
- [ ] 7.2 If interruption occurred after lockfile replacement but before build success, apply the final candidate-fingerprint guard before restoring/verifying the backup; preserve external changes as blocking conflict.
- [ ] 7.3 Preserve completed Ready to activate state as a durable checkpoint rather than treating it as interrupted.
- [ ] 7.4 Return interrupted pre-start authentication to Ready, recover confirmed started activation as activation failure, resume/verify interrupted restoration, and block when activation start is indeterminate.
- [ ] 7.5 Report blocking interrupted/unsafe state instead of starting over when a process may remain, the lockfile is invalid, restoration cannot be verified, or transactional state has an unsupported schema.
- [ ] 7.6 Allow logout/reboot to stop active check/update/build work without adding a shutdown inhibitor.

## 8. AGS Dialog

- [ ] 8.1 Add a lazy AGS System Update Dialog that mirrors the design-system contract without importing React or Storybook code.
- [ ] 8.2 Add an AGS adapter for runner commands, versioned state validation, filesystem-event subscription, operation reconnection, and backend initialization failure.
- [ ] 8.3 Register `system-update-dialog` in `ags-bundled` with `show`, `hide`, `toggle`, `check`, and `is-visible` requests.
- [ ] 8.4 On open, show valid cache immediately, start checking automatically when absent, refresh stale cache in place, or reconnect to active/pending/unsafe state.
- [ ] 8.5 Render checking, cached/no-update results, candidate update, build, Ready to activate, authentication error, activation, success, cancelled check, recoverable failures, and unsafe recovery.
- [ ] 8.6 Implement normal Close/Escape behavior outside active activation, Hide-and-continue during lockfile update/build, cancellable checking, and non-dismissible started activation.
- [ ] 8.7 Implement modal focus containment, initial focus, focus restoration, closed-state removal from keyboard navigation, mixed checkbox accessibility, and accessible progress descriptions.
- [ ] 8.8 Keep Technical details collapsed outside failures, open it for failures/unsafe recovery, and copy the complete transaction log from the floating output action.
- [ ] 8.9 Reflect actual timer state in Automatically check for updates; enable/start or stop/disable the user timer, allow manual checks while disabled, and revert/report failed changes.
- [ ] 8.10 Notify only while hidden for Ready to activate, terminal failures, unsafe recovery, and activation success.

## 9. Fish Client Migration

- [ ] 9.1 Keep `flake_update_interactive` as the terminal entry point while moving core execution to the structured runner.
- [ ] 9.2 Preserve Fish-owned argument handling, selection, confirmation, and terminal rendering.
- [ ] 9.3 Map runner outcomes to successful, pending activation, cancelled, restored failure, and unsafe recovery messages without parsing decorated output.
- [ ] 9.4 Use only `NH_OS_FLAKE`; reject mismatched positional targets, preserve `--force` and `--notify`, accept `--rebuild` and `--cache` as deprecated no-ops for one migration cycle, then remove those flags with the terminal desktop fallback.

## 10. Start Menu Integration

- [ ] 10.1 Replace the terminal launch with an AGS dialog show/check request after runner parity is verified.
- [ ] 10.2 Show current update/build/activation phase while active and focus the existing operation when selected.
- [ ] 10.3 Show Ready to activate instead of a cache count while a pending closure exists.
- [ ] 10.4 Show Update failed for an unacknowledged hidden recoverable failure, then return to validated cache state after opening or dismissal.
- [ ] 10.5 Keep Start Menu dialog state Nix-only and refresh its validated badge asynchronously after successful activation.
- [ ] 10.6 Keep activation success primary when post-success cache refresh fails; surface only a secondary warning.
- [ ] 10.7 Retain the terminal launcher as a rollback path for one migration cycle.

## 11. Validation

- [ ] 11.1 Add runner tests with temporary same-filesystem lockfiles and fake check, update, build, authentication, activation, restoration, systemd, and generation adapters.
- [ ] 11.2 Cover cache migration, input classification, complete fingerprints, partial-check rejection, cache cancellation retention, timer/manual collision, stale visible cache, selection reconciliation, and external lock changes.
- [ ] 11.3 Cover empty selection, symlink rejection, candidate isolation, write-ahead/fsync failpoints, atomic replacement, changed resolved revisions, identical candidate build, and update failure without real-lock mutation.
- [ ] 11.4 Cover canonical store-path validation and swapped result links, build success/pending persistence/discard, build failure restoration, external-change recovery conflicts, authentication cancellation, activation launch failure, activation success, activation failure restoration, indeterminate activation start, and unsafe restoration blocking.
- [ ] 11.5 Cover schema upgrade/downgrade blocks and interruptions before backup, after replacement, during build, at Ready to activate, during authentication, activation, and restoration without mutating the live system profile or repository lockfile.
- [ ] 11.6 Cover log safety-ceiling and log/state write failures before and after mutation without losing recovery evidence.
- [ ] 11.7 Verify AGS request handling, filesystem-event reconnection, dismissal rules, focus behavior, timer state rollback, notifications, bounded state output, and backend-unavailable behavior.
- [ ] 11.8 Run targeted Fish/Bun checks, NixOS module validation, AGS validation, `pnpm build-storybook`, strict OpenSpec validation, and `stow -n .`.
