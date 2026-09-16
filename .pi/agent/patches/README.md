# Pi package patches

Tracked patches preserve local changes to pinned Pi extensions:

- `@ff-labs+pi-fff+0.10.6.patch` disables FFF's native watcher on macOS, forwards Git-status metadata for `@` suggestions, and marks the bounded find and grep tools for read-only programmatic dispatch.
- `pi-mcp-adapter+2.32.1.patch` lets session approval brokers override cached MCP grants.
- `pi-lens+4.1.6.patch` refreshes and returns hashline anchors after immediate autoformatting, so formatter mutations do not leave the model with stale edit references.
- `pi-worktrunk+0.8.0.patch` adds a persistent Worktrunk command-reference cache.

Keep these patches here rather than editing Pi's installed packages without a reproducible source.

## Installation

1. Run `just install-pi` to install the pinned tooling, including
   `patch-package@8.0.1`.
2. Install the pinned extensions:

   ```sh
   pi install npm:@ff-labs/pi-fff@0.10.6
   pi install npm:pi-worktrunk@0.8.0
   pi install npm:pi-lens@4.1.6
   pi install npm:pi-mcp-adapter@2.32.1
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

The runner checks every installed package name and exact version before invoking
patch-package. A disposable copy verifies all selected patches before the installed
packages are modified. Patch application uses `--error-on-fail --error-on-warn` and
never `--partial`. Empty patches and patches without textual changes are rejected.

Automatic install and update commands treat patch failures as recoverable. They
print a warning and continue with the unpatched package so Pi can start. Run
`patch:packages` explicitly when maintaining patches; that command remains strict
and returns a failure for version mismatches or conflicts.

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
