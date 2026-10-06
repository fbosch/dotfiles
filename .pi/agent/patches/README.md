# Pi package patches

Tracked patches preserve local changes to pinned Pi extensions:
- `@ff-labs+pi-fff+0.11.0.patch` disables FFF's native watcher on macOS, forwards Git-status metadata for `@` suggestions, and marks the bounded find and grep tools for read-only programmatic dispatch.
- `pi-hashline-edit-pro+6.0.1.patch` keeps one registry identity when Pi exposes a session file after early tool calls, preserving served anchors and reclamation state; it also keeps source type-safe under the local ES2022 and exact-optional checks.
- `pi-lens+4.3.0.patch` refreshes and returns hashline anchors after immediate autoformatting, so formatter mutations do not leave the model with stale edit references; it also avoids duplicate deferred formatting and resolves bundled grammars.
- `pi-worktrunk+0.8.0.patch` adds a persistent Worktrunk command-reference cache. Worktrunk remains an unconfigured installed leftover; it is not listed in `settings.json` and is intentionally not installed or loaded by this guide.
- `@tintinweb+pi-tasks+0.9.0.patch` stores task snapshots as `pi-tasks-state` entries in Pi's session history and restores the active branch on resume, reload, fork, tree navigation, and compaction. Settings are global-only, and the built-in storage choices are `session-history` and `memory`. Explicit `PI_TASKS` shared-list overrides remain file-backed. It also declares host-provided `typebox` as a peer dependency.

The `@gotgenes/pi-subagents` patch was retired for 21.8.1: upstream now declares host-provided `typebox` as a peer dependency.

The runtime patch under `../runtime-patches/` keeps `proper-lockfile@4.1.2` compatible with Bun's Proxy-backed filesystem. `just install-pi` applies these patches after dependency installation.

Keep these patches here rather than editing Pi's installed packages without a reproducible source.

The tasks patch does not import or delete old `.pi/tasks/` files or global task
sidecars. Those lists remain untouched; new task changes belong to the session
history. Remove the task-storage customization when upstream supports branch-aware
session persistence and global-only settings.

## Installation

1. Run `just install-pi` to install the pinned tooling, including
   `patch-package@8.0.1`.
2. Install the pinned extensions:

   ```sh
   pi install npm:@ff-labs/pi-fff@0.11.0
   pi install npm:@tintinweb/pi-tasks@0.9.0
   pi install npm:pi-lens@4.3.0
   pi install npm:pi-hashline-edit-pro@6.0.1
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

The patch directory is the runner's package inventory. It derives each package name
and exact version from patch-package filenames such as `package+1.2.3.patch` and
`@scope+package+1.2.3.patch`. Adding or removing a patch does not require a matching
code change. Malformed filenames, multiple versions of one package, nested-package
patches, empty patches, and patches without textual changes are rejected.

Before invoking patch-package, the runner checks every discovered package against its
installed manifest. A disposable copy verifies all selected patches before the installed
packages are modified. Patch application uses `--error-on-fail --error-on-warn` and
never `--partial`.

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
   patch with patch-package. Keep the patch filename and `settings.json` pin aligned.
   The runner reads the package name and exact version from the filename. Do not
   weaken version checks to accept an upgrade.
3. Run the patch and extension regression tests, then `devenv test`. Tests apply
   the selected patches to disposable package copies before touching an installed
   package.

To retire one customization, remove its patch and reinstall the upstream package.
No runner change is needed. Restart Pi after replacing package code.

To remove patching entirely, delete all patch files, restore the previous npm command
(`["npm", "--save-exact"]`), and remove the patch runner integration.
