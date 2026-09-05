# Pi package patches

Tracked patches preserve local changes to pinned Pi extensions:

- `@gotgenes+pi-permission-system+31.1.1.patch` adds session-scoped infrastructure read-directory registration.
- `pi-worktrunk+0.8.0.patch` adds a persistent Worktrunk command-reference cache.

Keep these patches here rather than editing Pi's installed packages without a reproducible source.

## Installation

1. Run `just install-pi` to install the pinned tooling, including
   `patch-package@8.0.1`.
2. Install the pinned extensions:

   ```sh
   pi install npm:@gotgenes/pi-permission-system@31.1.1
   pi install npm:pi-worktrunk@0.8.0
   ```

   If they are already installed, run
   `bun run --cwd "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" patch:packages`.

3. Restart Pi to load the patched extensions.

`settings.json` routes Pi's npm operations through `lib/pi-npm.ts`. After a
successful local npm install, update, or uninstall, the runner applies patches
for the pinned packages that are present. Unrelated package roots and read-only
npm operations pass through. The runner preserves npm's status and `--save-exact`
behavior. Direct npm commands outside Pi bypass it; run `patch:packages`
afterwards.

The runner checks every installed package name and exact version **before**
invoking patch-package. It rejects requests for another pinned-package version.
A disposable copy verifies all selected patches before the installed packages
are modified. Patch application uses `--error-on-fail --error-on-warn` and never
`--partial`. Empty patches and patches without textual changes are rejected.
A failed patch stops the command; it does not roll back the npm installation that
preceded it. Conflict preflight is not a filesystem transaction: disk or permission
errors during writing can leave partially patched package files. Fix the filesystem
problem, remove and reinstall the pinned package through Pi, then restart Pi.

## Project-reference reads

The permission-system patch exposes an identity-scoped registration for absolute,
literal read directories. The project-references extension registers trusted
references outside the current working directory before an agent turn. This
bypasses only the `external_directory` gate for the built-in `read` tool.
Cross-cutting `path` denies still apply, and every other tool still uses the
normal policy.

Registrations are removed on session shutdown. Duplicate registrations remain
independent, so disposing one consumer cannot remove another consumer's access.

## Cache behavior

References are stored under
`${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/cache/pi-worktrunk/`. Entries are keyed by
`GENERATOR_REVISION`, the selected and resolved executable paths, and the binary's
device, inode, mode, size, nanosecond mtime, and ctime. Resolving the path catches
Nix upgrades and rollbacks even when timestamps are normalized.

Each lookup resolves `wt` using Pi's inherited PATH and command cwd. Identities
are checked around cache reads and discovery. Failed, cancelled, malformed, or
partial help discovery is not persisted, and references from a changed executable
are discarded. Script wrappers and unsupported platforms use live discovery
without caching. Aliases, repository identity, and activity markers remain fresh.

Cache reads are bounded and validated. Writes use private, exclusive temporary
files, flush their contents, then rename them atomically. Corrupt or unwritable
cache files do not prevent live discovery. Bump `GENERATOR_REVISION` when changing
reference generation, parsing, formatting, or the persisted schema.

## Updating or removing the patch

1. Review the new upstream package before changing its pin. Retire this patch if
   upstream supplies the cache.
2. Develop changes in a disposable package copy, then regenerate the affected
   patch with patch-package. Keep each package version in `lib/pi-npm.ts`, the
   patch filename, and `settings.json` aligned. Do not weaken version checks to
   accept an upgrade.
3. Run the patch and extension regression tests, then `devenv test`. Tests apply
   the selected patches to disposable package copies before touching an installed
   package.

To remove this customization, remove the patch and its guard, restore the
previous npm command (`["npm", "--save-exact"]`), and reinstall the upstream
package. Restart Pi after replacing package code.
