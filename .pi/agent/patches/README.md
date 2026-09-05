# Pi package patches

`pi-worktrunk+0.8.0.patch` adds a persistent command-reference cache to
`pi-worktrunk@0.8.0`. The patch is maintained here rather than as an untracked
edit to Pi's installed package.

## Installation

1. Run `just install-pi` to install the pinned tooling, including
   `patch-package@8.0.1`.
2. Install the pinned extension with `pi install npm:pi-worktrunk@0.8.0`.
   If it is already installed, run
   `bun run --cwd "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" patch:packages`.
3. Restart Pi to load the patched extension.

`settings.json` routes Pi's npm operations through `lib/pi-npm.ts`. After a
successful local npm install, update, or uninstall, the runner patches Worktrunk
if present. Unrelated package roots and read-only npm operations pass through.
The runner preserves npm's status and `--save-exact` behavior. Direct npm commands
outside Pi bypass it; run `patch:packages` afterwards.

The runner checks the installed package name and exact version **before**
invoking patch-package. It also rejects a request to install a different
Worktrunk version. Patch application uses `--error-on-fail --error-on-warn` and
never `--partial`. A failed patch stops the command; it does not roll back the
npm installation that preceded it. Review the error before starting Pi.

## Updating or removing the patch

1. Review the new upstream package before changing its pin. Retire this patch if
   upstream supplies the cache.
2. Develop changes in a disposable package copy, then regenerate the patch with
   patch-package. Keep the package version in `lib/pi-npm.ts`, the patch filename,
   and `settings.json` aligned. Do not weaken version checks to accept an upgrade.
3. Run the patch and cache regression tests, then `devenv test`. Tests reconstruct
   a pristine package in a temporary directory, check its source hash, and apply
   the tracked patch without modifying the active installation.

To remove this customization, remove the patch and its guard, restore the
previous npm command (`["npm", "--save-exact"]`), and reinstall the upstream
package. Restart Pi after replacing package code.
