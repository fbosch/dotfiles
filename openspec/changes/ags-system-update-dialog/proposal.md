## Why

System updates currently leave the desktop for an interactive terminal workflow. That path exposes useful outcomes, but AGS cannot present reliable progress, pending activation, recovery guarantees, or actions because the Fish command owns prompts and terminal rendering instead of a structured state contract.

## What Changes

- Finalize the design-system `SystemUpdateDialog` contract for checking, cached results, selected-input lockfile updates, automatic builds, explicit activation, cancellation, success, and distinct failures.
- Add an AGS System Update Dialog that mirrors the design-system contract without importing React or Storybook code.
- Add a user-systemd update runner that owns one operation, publishes versioned durable state, retains the latest complete log, and survives AGS reloads and dialog closes.
- Use `NH_OS_FLAKE` as the single authoritative flake target for checks, candidate lockfiles, and builds.
- Generate selected-input updates in a candidate lockfile, validate it, and atomically replace the real `flake.lock` only after successful resolution.
- Build automatically with `nh os build --out-link <operation-result>` after lockfile replacement, using indeterminate progress rather than parsing terminal output.
- Pause after a successful build in a durable Ready to activate state. Activate the exact retained closure only after explicit confirmation by running `nixos-rebuild switch --store-path <operation-result> --elevate=run0`.
- Add and autostart `hyprpolkitagent` so polkit owns graphical authentication and the runner never handles passwords.
- Restore and verify the exact pre-update `flake.lock` after update, build, or started-activation failure. Preserve a blocking unsafe-recovery state when restoration fails.
- Integrate with the existing update-check service and timer while allowing cancellable runner-owned manual checks, versioned lock-aware caches, and Nix-only dialog state.
- Replace the Start Menu terminal launcher with the AGS dialog after runner parity, and expose current operation, Ready to activate, and unacknowledged failure states.
- Do not add generation rollback, reboot-required detection, Flatpak installation, arbitrary flake editing, or a general package manager in this slice.

## Capabilities

### New Capabilities

- `ags-system-update-dialog`: Design-system contract, structured NixOS flake update lifecycle, candidate-lock safety, split build and activation, graphical authentication, AGS dialog behavior, recovery guarantees, and Start Menu integration.

### Modified Capabilities

- None.

## Impact

- `design-system/src/components/SystemUpdateDialog/`: Revised state model, actions, stories, interactions, and accessibility behavior.
- `.config/ags/components/` and `.config/ags/services/`: New System Update Dialog and state-file adapter.
- `.config/ags/config-bundled.tsx`: Dialog registration and request API.
- `.config/ags/components/start-menu.tsx`: Dialog launch, operation status, pending activation, failure acknowledgment, and validated Nix badge state.
- `.config/fish/functions/flake_update_interactive.fish`: Terminal client migration to shared execution without treating decorated output as an API.
- `.config/fish/libexec/`: Versioned schemas, runner CLI, cache validation, selected-input candidate updates, durable state, and result serialization.
- `/home/fbb/nixos/modules/desktop/update-checker.nix`: Versioned lock-aware cache producer, shared locking, timer control integration, runner user service, and `hyprpolkitagent` configuration.
- Existing unversioned cache files are disposable and will be invalidated rather than dual-read.
- No new application dependency is expected beyond existing AGS, Fish, Bun, Nix, `nh`, systemd, `nixos-rebuild`, and NixOS-provided `hyprpolkitagent`.
