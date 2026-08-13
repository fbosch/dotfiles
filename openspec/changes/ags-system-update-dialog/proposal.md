## Why

System updates currently leave the desktop for an interactive terminal workflow. That path exposes useful outcomes, but AGS cannot present reliable progress, recovery guarantees, or actions because the Fish command owns prompts and terminal rendering instead of a structured state contract.

## What Changes

- Finalize the design-system `SystemUpdateDialog` contract for checking, available updates, lockfile mutation, rebuild/switch, cancellation, success, and distinct failures.
- Add an AGS System Update Dialog that mirrors the design-system contract without importing React or Storybook code.
- Add a structured update runner that reports phase, elapsed time, selected input revisions, command output, generation metadata, and terminal outcome to AGS.
- Preserve the existing safety boundaries: confirm before mutation, back up `flake.lock`, use the existing rebuild path, and restore the previous lockfile after rebuild/switch failure.
- Distinguish check failure, lockfile update failure, and rebuild/switch failure instead of collapsing them into one generic error.
- Replace the Start Menu system-update terminal launcher with the AGS dialog once the structured runner covers the current workflow.
- Treat invalid cache data as a fresh-check trigger, not a user-facing error.
- Defer build-only followed by explicit `Activate now` execution. The design-system state remains a future contract because the current runtime uses `switch`, which builds and activates in one command.
- Do not add reboot-required detection, generation rollback, Flatpak installation, arbitrary flake editing, or a general package manager in this slice.

## Capabilities

### New Capabilities

- `ags-system-update-dialog`: Design-system contract, structured NixOS flake update lifecycle, AGS dialog behavior, recovery guarantees, and Start Menu integration.

### Modified Capabilities

- None.

## Impact

- `design-system/src/components/SystemUpdateDialog/`: Finalized component contract, stories, interactions, and state coverage.
- `.config/ags/components/` and `.config/ags/services/`: New System Update Dialog and update-process adapter.
- `.config/ags/config-bundled.tsx`: Register the dialog and request API in the bundled AGS process.
- `.config/ags/components/start-menu.tsx`: Open the AGS dialog and refresh badge state after terminal outcomes.
- `.config/fish/functions/flake_update_interactive.fish`: Reuse or delegate core update execution without treating terminal decoration as an API.
- `.config/fish/libexec/`: Structured runner or helpers for cache validation, update selection, process events, and result serialization.
- `/home/fbb/nixos/modules/desktop/update-checker.nix`: Potential producer changes if the existing checker must expose additional structured metadata; implementation remains in the separate NixOS repository.
- No new runtime dependency is expected beyond existing AGS, Fish, Bun, Nix, `nh`, and systemd tooling.
