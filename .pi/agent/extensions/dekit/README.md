# Dekit script tool

The agent uses one `dekit` tool to discover public Just recipes and
`package.json` scripts, then manage them as persistent project tasks.
The manual `/just <recipe> [arguments]` command remains unchanged.

Requires dekit 0.10.0 on `PATH`, Just for Just recipes, and the project's
package manager. Run `/reload` after changing the extension.

## Usage

Tool arguments are JSON:

```json
{"action":"discover","query":"test"}
{"action":"start","script":"package:test","arguments":["--watch"]}
```

Use the exact `task` path returned by `start` for `status`, `output`, `stop`,
or `restart`. Omit `task` from `status` to list Pi-managed tasks.

- `start`, `stop`, and `restart` require interactive confirmation.
- A successful mutation returns `accepted: true`. This is an acknowledgement,
  not script completion. Check `status` for `state` and `exit_code` or `signal`.
- `output` returns the current terminal screen, not a complete log. It may
  initially be blank, and large screens are truncated.
- `stop` unpins and stops a task. Dekit can start it again if a dependent
  still needs it.

## Project boundaries

The canonical Pi working directory is the explicit dekit project root.
Discovery reads a Justfile and `package.json` directly in that directory,
without searching parent directories. Recipe comments and package script
bodies supply discovery descriptions. Private Just recipes are excluded.

Package-manager selection uses `packageManager`, then lockfiles, then npm.
Conflicting lockfiles without `packageManager` are rejected. Arguments are
passed as separate command arguments, not interpolated into a shell command.

All actions require project trust. Task paths use the reserved `pi/` prefix;
globs, tags, other runners, and unrelated tasks are rejected. Starting a
missing runner loads its project configuration. Read-only actions never
start a runner. Tasks survive Pi shutdown; the extension does not own or stop
the shared runner. If a task already exists, use `restart` rather than
`start`.

## Maintenance

`catalog.ts` discovers scripts and constructs command arguments; `index.ts`
registers the tool and manages task operations. Add scripts to the project's
Justfile or `package.json`, not to this extension.

Run regression tests and the installed-CLI smoke test from the dotfiles root:

```sh
PI_DEKIT_LIVE=1 devenv test --option enterTest:string \
  'cd .pi/agent && bun test extensions/dekit extensions/just && bun run typecheck' \
  --no-tui
```

Without `PI_DEKIT_LIVE=1`, the installed-CLI test is skipped. The live test
uses an isolated temporary project and stops only its own runner.
