# Pi package patches

Tracked patches preserve local changes to pinned Pi extensions:
- `@ff-labs+pi-fff+0.11.0.patch` disables FFF's native watcher on macOS, forwards Git-status metadata for `@` suggestions, and marks the bounded find and grep tools for read-only programmatic dispatch.
- `pi-hashline-edit-pro+6.0.1.patch` is rebased onto 7.1.1. It keeps one registry identity when Pi exposes a session file after early tool calls, preserving served anchors and reclamation state; it also keeps source type-safe under the local ES2022 and exact-optional checks and exposes processed image payloads and notes to codemode's `image()`.
- `pi-lens+4.3.0.patch` is rebased onto 4.4.4. It refreshes hashline anchors after immediate formatting, avoids duplicate deferred formatting, and runs Fallow alongside the primary language server as an advisory-only auxiliary that reports new workspace findings after edits. Upstream now resolves bundled grammars.

The standalone task checklist lives in `../extensions/tasks/`. It stores versioned snapshots in Pi session history under its own entry type and ignores old pi-tasks state.


Pi runtime and dependency patches live in `~/nixos/modules/development/ai/pi/` and apply when Nix builds Pi. Dotfiles carries only extension patches.

Keep these patches here rather than editing Pi's installed packages without a reproducible source.

## Installation

1. Run `just install-pi` to install the pinned tooling, including
   `patch-package@8.0.1`.
2. Install the pinned extensions:

   ```sh
   pi install npm:@ff-labs/pi-fff@0.11.0
   pi install npm:pi-lens@4.4.4
   pi install npm:pi-hashline-edit-pro@7.1.1
   ```

   If they are already installed, run
   `bun run --cwd "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" patch:packages`.

3. Restart Pi to load the patched extensions.

### Fallow diagnostics

The Fallow auxiliary matches the Neovim `fallow` client in
`.config/nvim/lua/plugins/core/lsp.lua`. It starts for JavaScript and TypeScript
files at the nearest ancestor containing `pnpm-workspace.yaml`, `.fallowrc.json`,
`.fallowrc.jsonc`, `fallow.toml`, `.fallow.toml`, or `.git`. It runs `fallow-lsp`
from PATH first, then the project's `node_modules/.bin/fallow-lsp`. It never
installs Fallow automatically.

Fallow publishes findings for the whole workspace, including files that were not
opened. The patch keeps every publication. After each edit, the tool result lists
findings that appeared since the previous report, from any file: errors and
warnings by path and line, up to 20, and hints as counts per rule. A finding that
clears and returns counts as new again. Findings from a scan that finishes after an
edit's result appear with the next edit.

Fallow findings stay advisory, including diagnostics at error severity.
The primary language server, such as `tsc`, continues to provide type errors.
Add `fallow` to `lsp.disabledServers` to disable the auxiliary. The existing
Pi Lens trust, capacity, and secondary-session policies still apply.

`settings.json` routes Pi's npm operations through `lib/pi-npm.ts`. After a
successful local npm install, update, or uninstall, the runner applies patches
for the pinned packages that are present. Unrelated package roots and read-only
npm operations pass through. The runner preserves npm's status and `--save-exact`
behavior. Direct npm commands outside Pi bypass it; run `patch:packages`
afterwards.

The patch directory is the runner's package inventory. Filenames such as
`package+1.2.3.patch` and `@scope+package+1.2.3.patch` identify the package and retain
the patch's source-version provenance. That filename version is not a compatibility
check. The reviewed content gate lives in `targets.tsv`, with one row per patched file:
package name, original patch filename, package-relative path, preimage SHA-256, and
postimage SHA-256. Use `-` for a file that must be absent before or after the patch,
such as a newly created file.

The runner checks that every patch targets exactly the files listed in `targets.tsv`,
then hashes all selected targets before applying anything. A package must be wholly at
its reviewed preimages or wholly at its reviewed postimages. Unknown contents and mixed
preimage/postimage states fail before mutation. Exact postimages make repeated runs
idempotent. These checks use file contents, so a different dependency version is allowed
when its patched files still match the reviewed preimages. A same-version package with
changed target content is rejected.

`patch-package` derives its warning from the version in the patch filename. The runner
copies selected patches into a disposable directory and substitutes the installed
version in those temporary filenames. The tracked filename remains unchanged as
provenance, and `--error-on-fail --error-on-warn` stays enabled. The runner applies the
selected patches to disposable package copies first and checks their exact postimage
hashes before it touches installed packages. It checks the installed postimages again
after application. The runner never uses `--partial`.

Automatic install and update commands treat patch failures as recoverable. They print
a warning and continue with the unpatched package so Pi can start. Run `patch:packages`
explicitly when maintaining patches; that command remains strict and fails on unknown
contents, mixed states, or patch conflicts.

## Updating or removing the patch

1. Review the new upstream package before changing its pin. Retire this patch if
   upstream supplies the customization.
2. Develop changes in a disposable package copy, then regenerate the affected
   patch with patch-package. Keep the package identity and original patch filename
   intact. Recalculate the affected `targets.tsv` rows from the exact pristine
   preimage and the result of applying the reviewed patch. For a new or deleted file,
   record `-` on the absent side. Do not infer hashes from a version number or patch
   context alone.
3. Run the patch and extension regression tests, then `devenv test`. The runner
   checks all selected preimages, tests patch application on disposable copies, and
   verifies their postimage hashes before it modifies an installed package.

To retire one customization, remove its patch and its `targets.tsv` rows, then reinstall
the upstream package. No runner change is needed. Restart Pi after replacing package code.

To remove patching entirely, delete all patch files, restore the previous npm command
(`["npm", "--save-exact"]`), and remove the patch runner integration.
