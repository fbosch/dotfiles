# Dekit script tool

The agent uses one `dekit` tool to discover public Just recipes,
`package.json` scripts, and evaluated devenv tasks, then manage them as
persistent project tasks.
The manual `/just <recipe> [arguments]` command remains unchanged.
The tool auto-activates when the project root contains `justfile`, `Justfile`,
`.justfile`, `package.json`, or `devenv.nix`; elsewhere it remains deferred
unless explicitly loaded.

Requires the local dekit 0.10.2 idle-registration patch from
`~/nixos/pkgs/by-name/dekit`, including a patched project runner, plus Bun,
Just for Just recipes, the project's package manager, and devenv for Nix
tasks. Run `/reload` after changing the extension.

## Usage

Tool arguments are JSON:

```json
{"action":"discover","query":"test"}
{"action":"inspect","script":"just:build"}
{"action":"start","script":"package:test","arguments":["--watch"]}
```

Use the exact `task` path returned by `start` for `status`, `output`, `stop`,
or `restart`. Omit `task` from `status` to list imported tasks.

- Starting and restarting catalogued public scripts do not require per-run confirmation.
- Stopping a task requires interactive confirmation.
- A successful mutation returns `accepted: true`. This is an acknowledgement,
  not script completion. Check `status` for `state` and `exit_code` or `signal`.
- `output` returns the current terminal screen, not a complete log. It may
  initially be blank, and large screens are truncated.
- `stop` unpins and stops a task. Dekit can start it again if a dependent
  still needs it.

## Script inspection

`inspect` reads the current public catalog using a canonical script ID. It
does not classify, prompt for confirmation, or contact the runner. Just
parameters retain their declaration order and report `name`, `kind`,
`required`, `hasDefault`, `flag`, `multiple`, and available `long`, `short`,
and first-line `help` metadata. `star` accepts zero or more arguments;
`plus` accepts one or more. Default expressions and command bodies remain local.

Package scripts and devenv tasks return `parameters: null` because their
argument schemas are unknown. A Just recipe with no parameters returns
`parameters: []`.
Inspection reports parameter metadata, not a complete argument validator.

## Discovery ranking

Queries matching an existing canonical script ID resolve that script locally
without inference. Other nonblank queries use the shared tool-discovery
classifier when enabled and available. It selects one best script, or no
match, from at most 24 candidates. Names,
compact descriptions, and tags are sent to the classifier; command bodies,
fingerprints, paths, and execution metadata stay local. Blank queries browse locally.
Disabled, unavailable, timed-out, or malformed classification falls back to
deterministic local ranking. A valid no-match answer stays empty.
`fallbackReason` reports the classifier's safe reason code, such as
`disabled`, `model-unavailable`, `timeout`, or `invalid-response`, in both
structured output and the local result header. Provider messages and
diagnostics are not included. Blank browsing and exact-ID lookups have
no fallback reason.

Just recipe `[group('validation')]` attributes become `tags` in discovery
results and the compact text index. Groups also participate in local matching
and shortlisting. Untagged recipes and package scripts return `tags: []`.
The classifier receives up to eight unique, nonempty first-line tags per
candidate, limited to 64 characters each, in both state and choice descriptions.
Returned tags retain the original group values.

Discovery returns a compact text index plus structured script IDs, parameter
names, and completeness fields: `totalScripts` counts the catalog; `considered`
counts the local catalog or classifier pool; `hasMore` reports undisplayed local
matches or scripts outside that pool. The classifier's one-best result is not an exhaustive
list of semantic matches. Configuration follows the existing
`classifier.toolDiscovery.enabled` and `classifier.toolDiscovery.timeoutMs` settings.

## Project boundaries

The canonical Pi working directory is the explicit dekit project root.
Discovery checks for a Justfile, `package.json`, and `devenv.nix` directly in
that directory, without searching parents. Just recipes use compact
first-line comments; package scripts use their names, never command bodies.
Private Just recipes are excluded.

Package-manager selection uses `packageManager`, then lockfiles, then npm.
Conflicting lockfiles without `packageManager` are rejected. Arguments are
passed as separate command arguments, not interpolated into a shell command.
Devenv discovery uses `devenv tasks list --json`, which evaluates Nix and
includes imported task definitions without executing tasks or shell-entry
hooks. Failed listing produces a `warnings` entry; available Just/package
scripts remain usable. Devenv starts use `devenv tasks run --mode before`
so dependencies run first. Explicit inputs accept `--input VALUE` and
`--input-json VALUE`; extra task names and execution-mode overrides are
rejected.

All actions require project trust. Imported task paths live directly under
`just/`, `package/`, or `devenv/` with stable command hashes;
globs, tags, other runners, and unrelated tasks are rejected. Starting a
missing runner loads its project configuration. Read-only actions never
start a runner. Tasks survive Pi shutdown; the extension does not own or stop
the shared runner. Starting a matching registered task verifies its command
and working directory inside the runner, then starts it without restarting
an already active task. A conflicting definition is an error.

## Neovim native console

In Neovim, `<A-m>` or `:FTermDekit` toggles dekit's built-in task console.
Each new attachment first imports the current Just/package/devenv catalog
through `import-scripts.ts`, then runs `dekit -C <project-root> attach`.
Recipes appear as idle tasks without executing them or generating project
configuration. Pi and Neovim use the same catalog, command arguments, and
task IDs. Existing configured tasks and running children stay untouched.
Labels identify the source script; recipes requiring arguments are marked
`requires: ...`. Supply their arguments through Pi to start an argument-specific
task. Changed command variants remain separate tasks rather than replacing
existing processes.

With the task list focused, `s` starts a selected task and `r` restarts it.
Hiding the terminal keeps the console client and its tasks running.
Reopening the same project's live console reuses that client without
importing scripts again. A new attachment imports the current catalog.
The quit menu can stop the shared runner, which affects both clients.

Projects with an `.envrc` reuse Neovim's inherited direnv environment when
it matches the project and remains approved. Otherwise, both the import
and native console run through `direnv exec`.

Before using this integration:

1. Install the patched dekit package through Nix and verify `dekit register --help`.
2. Run `just stow-apply` from `~/dotfiles` after adding new files, so
   `~/.pi/agent/extensions/dekit/import-scripts.ts` is deployed. Existing
   file links reflect edits immediately, but new files need Stow links.
3. Explicitly upgrade existing project runners to the patched kernel with
   `dekit -C <project-root> runner upgrade`. Check kernel selection if it still
   points at an older pinned binary.
4. Restart Neovim and reload Pi's extension.

Existing runners with the old `pi/` paths need an explicit reset before
importing the new grouping. Reset only an inactive runner; this clears
registered task IDs and terminal history. Other project runners are not
changed automatically.
The importer never upgrades or restarts a runner automatically. An older
runner without registration support reports an error instead of falling
back to executing recipes.

## Maintenance

`catalog.ts` discovers scripts and constructs command arguments;
`import-scripts.ts` registers their native tasks without starting them.
`index.ts` manages Pi's tool operations. Add scripts to the project's
Justfile, `package.json`, or `devenv.nix`, not to this extension.

Run regression tests and the installed-CLI smoke test from the dotfiles root:

```sh
PI_DEKIT_LIVE=1 devenv test --option enterTest:string \
  'cd .pi/agent && bun test extensions/dekit extensions/just && bun run typecheck' \
  --no-tui
```

Without `PI_DEKIT_LIVE=1`, the installed-CLI test is skipped. The live test
uses an isolated temporary project and stops only its own runner.

The idle-import integration checks can use a built binary before it is
installed:

```sh
cd .pi/agent
PI_DEKIT_IMPORT_LIVE=1 PI_DEKIT_BINARY=/path/to/dekit \
  bun test extensions/dekit/__tests__/native-import.test.ts
```

These tests isolate user config and stop only their own temporary runners.
`PI_DEKIT_TUI_LIVE=1` enables the native PTY-rendering check.
`PI_DEKIT_LIVE=1` enables process execution/restart checks as well.
Those checks require PTY and process-execution permissions.
