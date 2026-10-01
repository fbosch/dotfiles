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
{"action":"inspect","script":"just:build"}
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

## Script inspection

`inspect` reads the current public catalog using a canonical script ID. It
does not classify, prompt for confirmation, or contact the runner. Just
parameters retain their declaration order and report `name`, `kind`,
`required`, `hasDefault`, `flag`, `multiple`, and available `long`, `short`,
and first-line `help` metadata. `star` accepts zero or more arguments;
`plus` accepts one or more. Default expressions and command bodies remain local.

Package scripts return `parameters: null` because their argument schema is
unknown. A Just recipe with no parameters returns `parameters: []`.
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
Discovery reads a Justfile and `package.json` directly in that directory,
without searching parent directories. Just recipes use compact first-line comments;
package scripts use their names, never command bodies. Private Just recipes are excluded.

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
