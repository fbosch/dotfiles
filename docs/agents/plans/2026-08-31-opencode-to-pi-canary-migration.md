# OpenCode to Pi Canary Migration

## Purpose

Run Pi alongside OpenCode, validate it on representative work, and promote it
only after the workflows and safeguards that matter have passed observable
gates.

This is a selective migration. It does not attempt to reproduce every OpenCode
agent, command, plugin, or TUI feature. OpenCode remains installed, configured,
and usable throughout the canary.

## Decisions

- Install `@earendil-works/pi-coding-agent` through the existing
  `numtide/llm-agents.nix` input.
- Start fresh Pi sessions. Keep OpenCode history as an archive rather than
  converting it.
- Use `@gotgenes/pi-permission-system` for deterministic allow, ask, and deny
  rules.
- Use manually selected, isolated OpenAI profiles first. Defer repository
  preference ordering and quota failover.
- Use `@ldelossa/pi-ide` for a partial Neovim canary. Retain OpenCode for
  workflows that need the complete bound-socket bridge.
- Pin every package to an audited version and introduce one concern at a time.
- Keep project trust at `ask`.
- Use an OS container, VM, or other real isolation boundary for unattended or
  untrusted work. Pi permission extensions are policy layers, not sandboxes.

## Baseline Inventory

The current repository contains:

- 59 canonical tracked skills under `.agents/skills`.
- Four skill mirrors, all symlinked to the canonical tree.
- 19 custom OpenCode agents and 19 OpenCode commands.
- Two base prompts and five snippets.
- Three active instructions and one inactive instruction.
- Six active server plugins and three active TUI plugins.
- Six Toolbox-managed MCP servers.
- Four global direct MCP declarations. Three are nominally enabled and two are
  core functional servers.

Pi already discovers `~/.agents/skills`, so it can use the canonical skills
without another mirror or a settings entry.

The archived Codex inventory reported 49 shared skills because it captured the
repository on 2026-08-05. It is historical evidence, not the current Pi
baseline.

## Package Decisions

Canary:

- Permissions: `@gotgenes/pi-permission-system@29.0.0`, introduced first.
- Search: `@ff-labs/pi-fff@0.10.6` in additive `tools-and-ui` mode.
- MCP: `pi-mcp-adapter@2.31.0` in proxy-only mode.
- Auth profiles: vendor the audited `@nanstey/pi-auth-profiles@0.1.1` source
  locally as the baseline for later account-routing parity work.
- Plan mode: the local `.pi/agent/extensions/plan-mode.ts` implementation.
- Subagents: `@gotgenes/pi-subagents@21.0.3` as the sole implementation.
- Neovim: `@ldelossa/pi-ide@0.2.5` as a partial IDE integration.
- Handoff: `@nicknisi/pi-handoff@0.1.7`.
- Herdr: `@ogulcancelik/pi-herdr@0.4.0` as an additive integration.

Hold:

- Shell sandbox: `pi-permission-modes@2.2.0`. This is an alternative permission
  engine, not a companion to the selected one.
- Structural search: `pi-ast-sgrep@2.0.2` until FFF is measured.
- Worktrunk: `pi-worktrunk@0.6.0` until session ownership is resolved.
- Multi-editor IDE: `pi-x-ide@1.19.5`. It conflicts with the selected IDE.
- GitHub polling: `@gotgenes/pi-github-tools@4.4.0`. Its scope is narrow and its
  mutation tools do not confirm independently.
- Status line: `@narumitw/pi-statusline@0.50.0`. It lacks a profile indicator
  and polls Git.
- Context execution: `context-mode@1.0.169`. It has broad authority and overlaps
  several selected packages.

Reject:

- Neovim prompt bridge: `pi-nvim@0.2.4`.
- Interactive subagents: `amosblomqvist/pi-interactive-subagents@3.7.2`. It
  collides with the selected package's `subagent` tool, launches unbounded tmux
  subprocesses, targets the upstream `@mariozechner/pi-*` package namespace,
  and does not provide the parent-session identity required for permission
  forwarding. Restricted children also omit the permission extension. Its
  visible-pane and child-question UX remains useful prior art, but it cannot run
  beside or replace the selected implementation safely.
- Direnv: `pi-direnv@0.1.0` because it mutates process-wide environment.
- Azure DevOps: `@patimweb/pi-azure-devops@2.0.1` because target-specific safety
  can be bypassed.
- Web tools: `pi-web-kit@0.2.4` because it is outdated and duplicates retained
  tools.
- Usage identity: `@narumitw/pi-usage@0.59.0`. The existing WezTerm status
  already shows every named account's usage and reset state through `ocma`.

Do not install two permission engines, two subagent managers, or two IDE
integrations together. Their overlapping hooks make enforcement and failure
ownership dependent on load order.

## Phase 1: Install Pi Without Changing OpenCode

Add `pi` beside `codex`, `openspec`, and `agent-browser` in
`/Users/fbb/nixos/modules/development/ai.nix`.

The locked `numtide/llm-agents.nix` revision packages
`@earendil-works/pi-coding-agent@0.84.4`. Its wrapper disables Pi version checks
and telemetry. This phase does not require a `flake.lock` update.

Acceptance:

- The selected NixOS or Darwin configuration builds.
- `pi --version` reports `0.84.4`.
- `opencode` resolves to the same executable and starts with its existing
  configuration.
- No Pi state or credentials are added to the dotfiles repository.

Rollback:

- Remove `pi` from the Nix package list.

## Phase 2: Establish a Package-Free Baseline

Start Pi in the dotfiles repository without third-party extensions. Trust the
project explicitly, authenticate one provider, and exercise a fresh session
before adding packages.

Verify:

- Root `AGENTS.md` loads.
- The 59 canonical skills are discovered from `.agents/skills`.
- Session creation, resume, branching, and compaction work.
- `defaultProjectTrust` remains `ask`.
- `~/.pi/agent` is mode `0700`.
- Pi credential files are mode `0600`.
- OpenCode sessions are not imported or modified.

Acceptance:

- Pi can inspect the repository and complete one read-only task with only core
  tools.

Rollback:

- Stop using Pi. No OpenCode rollback is needed.

Package-free baseline outcome on 2026-09-01:

- Added `scripts/secure-pi-agent-dir.sh` and routed supported Stow and Home
  Manager activation paths through the same `0700` directory invariant.
- Corrected the live `~/.pi/agent` mode to `0700`; `auth.json` remains `0600`.
- Started Pi with `--no-extensions`, explicitly trusted the project for the
  canary run, loaded the root `AGENTS.md`, and discovered all 59 canonical
  skills.
- Completed a read-only task with only Pi's core `read`, `grep`, `find`, and
  `ls` tools enabled.
- Verified session creation, exact resume, and forking in an isolated temporary
  session directory.
- Verified manual compaction in an isolated temporary project after lowering
  `keepRecentTokens` for the test; context fell from 9,153 estimated tokens to
  2,698 without losing the validation token.
- Confirmed the global settings do not override Pi's `ask` project-trust
  default. OpenCode sessions were not imported or modified.

## Phase 3: Add Permissions and FFF

Canary only these packages:

```text
@gotgenes/pi-permission-system@29.0.0
@ff-labs/pi-fff@0.10.6
```

Start permission policy from `*: ask`. Allow ordinary workspace reads and a
narrow set of read-only shell commands. Explicitly deny known secret paths,
including `.env` files and `~/.ssh/**`. Keep writes, external directories,
arbitrary shell commands, MCP calls, and extension tools at `ask`.

Configure FFF with:

```json
{
  "mode": "tools-and-ui",
  "enableFsRootScanning": false,
  "enableHomeDirScanning": false,
  "followSymlinks": false
}
```

Do not use FFF `override` mode during the canary.

Acceptance:

- Workspace searches work without replacing Pi's built-in search tools.
- `@` file autocomplete uses FFF's fuzzy, frecency-ranked index.
- Secret reads are denied.
- External reads prompt.
- Writes and mutating shell commands prompt.
- Representative allow, ask, and deny outcomes are verified directly.

Rollback:

- Start Pi with `--no-extensions` or remove the two package entries.

Permission-system canary outcome on 2026-08-31:

- Installed and pinned `@gotgenes/pi-permission-system@29.0.0`.
- Allowed a repository read.
- Denied `~/.pi/agent/auth.json` through the cross-cutting path policy.
- Asked before a repository write and an external-directory read; neither ran in
  the non-interactive test.
- Removed silent Bash allowances after adversarial testing found Git environment
  variables and output options could hide execution or writes.
- Configured all Bash commands to ask, with broad denials for `rm` and
  `git reset` spellings.
- Disabled permission review logs because command strings are stored unredacted.
- Do not use session-wide approval: package v29 allows a session rule to
  override a configured deny.
- Treat the extension as a decision aid rather than a sandbox or immutable
  authorization boundary.

FFF canary outcome on 2026-08-31:

- Installed and pinned `@ff-labs/pi-fff@0.10.6`; its Node and Bun native
  bindings resolved at the same version with zero reported npm vulnerabilities.
- Added a commit-pinned schema and configured additive `tools-and-ui` mode with
  filesystem-root scanning, home-directory scanning, and symlink traversal
  disabled.
- Verified `fffind` and `ffgrep` search the workspace while Pi's built-in `find`
  remains available.
- Confirmed normal permission handling asks before workspace FFF calls, denies
  an explicit `~/.pi/agent/auth.json` search, and asks before an external path.
- Confirmed launches from the home directory and filesystem root refuse to
  index.
- Ignored Pi-local FFF databases under `~/.pi/agent/fff/`.
- Package v0.10.6 does not register `fff-multi-grep` by default despite listing
  it in the README. Its source gates the tool behind the undocumented
  `PI_FFF_MULTIGREP=1` flag and describes it as slated for removal, so the
  canary does not enable it.

## Phase 4: Add MCP Incrementally

Add `pi-mcp-adapter@2.31.0` with proxy-only discovery:

```json
{
  "settings": {
    "directTools": false,
    "hostConfigDiscovery": "off"
  }
}
```

Start with one pinned, read-only MCP server. Do not import the complete OpenCode
Toolbox configuration. Add Context7, Exa, GitHub, ast-grep, Serena,
chrome-devtools, and shared-todo separately only after each preceding server
passes.

Keep FFF as a Pi package rather than exposing a second FFF implementation
through MCP.

Acceptance:

- The model sees only adapter proxy schemas rather than every underlying server
  tool schema.
- The server starts lazily.
- Read-only calls work.
- Mutating MCP tools remain approval-gated.
- Host MCP configuration is not silently imported.

Rollback:

- Remove the adapter package or the individual server declaration.

MCP parity canary outcome on 2026-09-01:

- Installed and pinned `pi-mcp-adapter@2.31.0` with package skills disabled.
  npm reported zero vulnerabilities and no additional install scripts were
  approved.
- Configured `directTools: false`, `hostConfigDiscovery: "off"`,
  `scriptMode: false`, and `mcpFooterStatus: "off"`. Pi exposes the global
  `mcp` proxy plus one lightweight namespace proxy per cached server; it does
  not expose `mcpScript` or any individual server tool schema.
- Started with only Context7, running under rootless Podman with a read-only
  filesystem, all capabilities dropped, and `no-new-privileges`.
- Pinned the multi-architecture Context7 image to
  `sha256:1174e6a29634a83b2be93ac1fefabf63265f498c02c72201fe3464e687dd8836`.
  Cosign verified the image against Docker's MCP public key and transparency
  log.
- Added GitHub, Context7, Exa, Serena, ast-grep, Chrome DevTools, and shared-todo.
  The merged configuration contains only these seven explicit servers and keeps
  host-specific discovery off.
- Pinned Exa and ast-grep to Cosign-verified Docker MCP index digests. Pinned
  Serena to its stable `v1.7.0` image digest and Playwright to its `v1.57.0`
  image digest. GitHub remains supplied by the Nix-managed `gh 2.98.0`, whose
  bundled MCP server reports `1.10.1`.
- Confirmed all seven servers connect lazily and cache 112 tool definitions:
  GitHub 44, Context7 2, Exa 2, Serena 29, ast-grep 1, Chrome DevTools 29, and
  shared-todo 5.
- Confirmed an ast-grep structural search succeeds against the read-only
  workspace mount.
- Confirmed GitHub and the other mutation-capable servers remain protected by
  adapter-level approval in addition to Pi's outer permission prompt.
- Exa catalog discovery works, but execution remains blocked until
  `EXA_API_KEY` is present in the Pi process environment.
- Chrome DevTools retains OpenCode's exact `chrome-devtools-mcp@1.2.0` behavior.
  Its package is exact-version pinned, but it is fetched into an ephemeral
  container at startup and its Puppeteer version does not officially match the
  pinned Playwright Chromium revision.
- Kept FFF as Pi's native package instead of duplicating its MCP server. Kept
  the OpenCode socket-bound Neovim MCP and hidden `ai_pointer_exa` duplicate out
  of Pi; they are not portable shared MCP capabilities.
- Confirmed an idle Pi session starts no additional MCP containers. Containers
  started for metadata discovery stop when the session exits.
- Confirmed normal headless use fails closed with `approval required` before an
  MCP call runs.
- Loaded only the adapter for functional isolation and resolved Bun to
  `/oven-sh/bun` through Context7. The container stopped after the session.
- Ignored adapter metadata and onboarding state under `~/.pi/agent`; neither
  contains declarative configuration.
- Confirmed `pi --no-extensions` starts without the `mcp` tool.

## Phase 5: Canary Manual Auth Profiles

Vendor the `@nanstey/pi-auth-profiles@0.1.1` extension locally under
`.pi/agent/extensions/auth-profiles/`. Do not install the npm package alongside
the local copy.

Create two isolated profiles through Pi and switch them manually. Use the
existing WezTerm Codex status to compare known quota or reset values for the
same profile alias. Do not add repository profile mappings during this phase.

This phase intentionally defers behavior implemented by
`.config/opencode/plugins/openai-account-selector/selection.ts`:

- Ordered repository account preferences.
- Alias resolution.
- Usage-aware selection.
- Exclusion after a failed account.
- Automatic quota failover.

Acceptance:

- Credentials remain isolated by profile.
- Switching profiles changes the real provider account.
- The selected Pi profile corresponds to the manually verified account with the
  same alias in the WezTerm Codex status.
- Restarting Pi preserves the documented profile selection.

Rollback:

- Return to Pi's first-party single credential.
- Keep OpenCode as the path for automatic repository routing and failover.

Phase 5 setup status on 2026-09-01:

- Vendored the `0.1.1` extension source and MIT license under
  `.pi/agent/extensions/auth-profiles/`, with its npm integrity recorded in the
  source header.
- Kept the npm package out of `settings.json`; Pi discovers the managed local
  extension directly.
- Confirmed Pi `0.84.4` starts an offline RPC session with the extension loaded,
  binds the built-in default credential store, and handles `/profile` without an
  extension error.
- Added `fbb`, `jpb`, and `ct` profile credential files through Pi and selected
  `fbb` for the dotfiles repository. Credential isolation, account identity, and
  restart persistence still require direct verification.
- Published the active profile through Pi's extension-status API. The custom
  prompt renders the profile and refreshes immediately after a profile rebind.
- Canary-installed `@narumitw/pi-usage@0.59.0`, which resolved
  `@narumitw/pi-tui-kit@0.49.3`, with zero reported npm vulnerabilities and no
  newly approved install script.
- Confirmed named-profile usage queries work, but the package menu replaces the
  editor through `ctx.ui.custom()` without overlay options. The prompt's
  non-capturing autocomplete overlay remains mounted, causing the two interfaces
  to overlap.
- Removed the package instead of maintaining a local UI fork. Its automatic
  provider polling and prompt status duplicate `.config/wezterm/status/codex.lua`,
  which already renders all `ocma` profiles, quota windows, reset countdowns,
  and reset credits.
- The package created no `pi-usage.json`. The three named credential files
  remain mode `0600` inside a mode `0700` directory.

## Phase 6: Add Plan Mode and Subagents

Canary the local `.pi/agent/extensions/plan-mode.ts` implementation. Plan mode
keeps only its explicit read-only tool allowlist, so direct writes and all shell
forms are unavailable rather than classified by command text.

After plan mode passes, add `@gotgenes/pi-subagents@21.0.3` with
`maxConcurrent: 1`. Start with one read-only `Explore` agent, an explicit tool
allowlist, and restrictive permission frontmatter. Keep the permission extension
loaded in children so approval requests can reach the parent UI.

`maxConcurrent` limits background children only. Foreground children bypass the
queue. With `abortAllOnInterrupt: true`, interrupt stops every running and queued
child; the package has no interactive command for stopping one selected child.

After the one-agent safety canary passes, port the 19 tracked OpenCode agent
definitions as Pi-native roles. Translate their tool and permission contracts;
do not copy unsupported OpenCode frontmatter or assume primary-agent behavior
exists in Pi. Keep role selection demand-driven even though every definition is
available.

Acceptance:

- Plan mode blocks direct and shell-mediated mutations.
- Unknown shell forms fail closed.
- The read-only child cannot write or run mutating commands.
- Child approval requests reach the parent UI.
- Interrupting the parent settles every running and queued child predictably.

Rollback:

- Remove the subagent package before removing the permission package.
- Keep plan mode only if its enforcement passed independently.

Phase 6 setup status on 2026-09-01:

- Added focused tests for the local plan mode. They cover the configured model
  and thinking level, removal of `write`, `edit`, `bash`, PowerShell, and MCP
  execution tools, exact restoration of the previous tool list, unavailable
  models, and busy-session toggles.
- Installed and pinned `@gotgenes/pi-subagents@21.0.3` with
  `maxConcurrent: 1` and `abortAllOnInterrupt: true`.
- Added one global `Explore` definition with only `read`, `grep`, `find`, `ls`,
  `fffind`, and `ffgrep`. Its permission frontmatter denies every unnamed tool
  and asks before external-directory access.
- Confirmed a child asked to create a marker had no mutation tool and left the
  filesystem unchanged. An external read produced a parent-side subagent
  approval prompt and remained denied.
- Confirmed two background children reach one running and one queued. Parent
  interrupt clears both without an extension error.
- Added Pi definitions for all 19 tracked OpenCode agent files while retaining
  the existing `explore` definition. Pi-specific frontmatter replaces OpenCode
  modes, temperature, tool names, and permission syntax. Read-only roles omit
  mutation tools; repository search roles can use FFF; shell and MCP access
  remains approval-gated. `commit` and `tutor` are callable children rather
  than selectable primary modes.
- Added `$PI_CODING_AGENT_DIR/AGENTS.md` with Pi-native routing guidance. It
  keeps orchestration in the parent, treats `maxConcurrent: 1` as a real
  admission limit, resumes parent-mediated questions by child ID, and requires
  direct integration validation of delegated work.
- Rejected `amosblomqvist/pi-interactive-subagents@3.7.2` for the canary after
  source review. It registers a conflicting `subagent` tool, has no concurrency
  queue, requires tmux, cannot run under Herdr, and does not implement the
  permission-system child convention. Do not install it beside
  `@gotgenes/pi-subagents`.
- Package installation exposed an npm reconciliation loop. Pi compared exact
  settings pins against caret ranges written to its generated npm manifest, and
  npm repeatedly changed the installed versions. The Stow symlink path also
  accumulated repeated `dotfiles/dotfiles` prefixes in `package-lock.json`.
- Set Pi's npm command to `npm --save-exact` and set
  `PI_CODING_AGENT_DIR` to the canonical Stow source path. Rebuilt the ignored
  package cache once. The lockfile fell from 62,871 to 1,336 lines, npm audits 57
  packages with zero reported vulnerabilities, and three warm RPC starts took
  1.07–1.14 seconds with no npm output or generated-file changes.

## Phase 7: Canary Neovim, Handoff, and Herdr

Add `@ldelossa/pi-ide@0.2.5` and pin the companion `ldelossa/pi-ide.nvim` commit
audited with that release. Disable automatic suggestions and debug logging.
Start with manual connection.

Test:

- Active file and cursor context.
- Selected text.
- Diagnostics injected into context.
- Interactive edit diffs.
- Accept and reject behavior.
- Sibling worktrees.
- Reconnection after resume and Herdr pane restoration.

Add `@nicknisi/pi-handoff@0.1.7` only after basic Pi session behavior is stable.
Add `@ogulcancelik/pi-herdr@0.4.0` as model-callable terminal control, not as a
replacement for lifecycle reporting.

OpenCode remains required for:

- Bounded reads of unsaved Neovim buffers.
- Visible-window and buffer discovery.
- Quickfix and location lists.
- Exact reveal, temporary highlights, and annotations.
- Clickable patch navigation.
- Neovim-owned agent session restoration.
- Herdr selected-session, title, permission, and question state reporting.
- Targeted `read_session` transcript recovery.

Acceptance:

- Pi never attaches to the wrong worktree's editor.
- Rejecting a diff leaves the source file unchanged.
- Accepting a modified diff writes the reviewed buffer contents.
- Handoff creates an editable, unsubmitted draft linked to its parent.
- Herdr refuses to close the pane running Pi.

Rollback:

- Disable the Pi extension and its Neovim companion independently.
- Continue using the existing OpenCode Neovim and Herdr integrations.

## Phase 8: Keep Direnv Tool-Scoped

Do not install `pi-direnv@0.1.0`. It mutates `process.env`, does not restore a
baseline, and can carry stale or secret values into later sessions.

Load the nearest allowed `.envrc` inside the repository from
`.pi/agent/extensions/direnv/`. Override Pi's built-in `bash` tool with its
supported `spawnHook`, and apply the exported values only to that subprocess.
Do not mutate the Pi process environment.

Acceptance:

- Repository tools on the exported `PATH` are available to agent `bash` calls.
- Removed variables are absent from agent `bash` calls.
- Direnv values do not enter `process.env` or provider requests.
- A blocked `.envrc` produces a warning and leaves the built-in `bash` tool in
  place.

Rollback:

- Remove `.pi/agent/extensions/direnv/`; no package state exists to remove.

## Phase 9: Persist Proven Configuration Safely

Do not persist canary settings in the repository until the preceding phases
pass.

Pi mixes configuration with credentials, sessions, package caches, trust state,
and editor locks under `~/.pi`. This repository accepts Stow directory folding
for Pi and keeps mutable or secret state out of Git through
`.pi/agent/.gitignore`.

Before managing additional `.pi/agent/*` files with Stow:

- Keep credential and runtime paths listed in `.pi/agent/.gitignore`.
- Add new third-party package state to that ignore file before enabling the
  package when its state is not declarative configuration.
- Narrow `.stow-local-ignore` line 13 from all nested Markdown to root-only
  Markdown so managed Pi Markdown files can be linked.
- Extend `test:stow` when a new managed Pi resource is added.
- Verify ignored credentials and runtime files remain absent from Git diffs and
  archives intended for sharing.

Tracked Pi files may include only:

- Non-secret settings.
- Permission policy.
- MCP declarations without credentials.
- Selected agent definitions.
- Prompt templates.
- Non-secret profile names.

Never track:

- `auth.json`.
- `auth-profiles/*.json`.
- `trust.json`.
- `npm/` or `git/` package directories.
- Session files.
- Logs or permission review logs containing command text.
- IDE lockfiles or bearer tokens.

Acceptance:

- `stow -n .` reports no conflict.
- The Stow test proves managed Pi configuration is deployed.
- A fresh Pi start loads the managed settings and prompts.
- `git check-ignore` covers every credential and runtime path Pi creates.
- No secret or runtime file appears in ordinary `git status` output.

Rollback:

- Back up required runtime state, then unstow the Pi configuration.

## Phase 10: Port Only Demonstrated Workflows

Keep Pi's default system prompt. Add a Pi-specific `~/.pi/agent/AGENTS.md`; do
not copy the OpenCode base prompt wholesale.

Start with prompt-only workflows such as:

- `commit-msg`.
- `plan-tasks`.
- `rmslop`.

Pi prompt templates already support `$ARGUMENTS`, positional arguments,
defaults, slicing, and argument hints.

Use the existing canonical skills directly for OpenSpec, PR descriptions,
diagnosis, review, and other specialized workflows. Hold Azure DevOps, PR
mutation, review-thread resolution, screenshots, and account-selection commands
until their tool dependencies have safe Pi replacements.

Acceptance:

- Each migrated prompt completes one real workflow without OpenCode-specific
  tool names.
- Prompt behavior is covered by an observable task result rather than textual
  similarity to the OpenCode prompt.
- No duplicate skill tree or host-neutral role abstraction is introduced without
  a second proven consumer.

Rollback:

- Remove the individual prompt template. OpenCode commands remain unchanged.

## Promotion Gate

Pi may become the default interactive agent only after all of these pass:

- At least five representative tasks across two repositories.
- Zero unapproved filesystem or Git mutations.
- Zero wrong-account selections after profile switching.
- Zero wrong-Neovim attachments across sibling worktrees.
- Plan mode blocks direct and shell-mediated writes.
- One read-only subagent completes with parent approval forwarding.
- One MCP server starts lazily and remains policy-gated.
- Handoff and resume preserve enough context to continue work.
- OpenCode remains callable without configuration rollback.

Changing Fish aliases, Worktrunk launch behavior, Neovim session ownership, or
the default agent command is outside the canary. Those changes require a
separate promotion plan.

## Validation Path

Run the smallest relevant check after each phase. Before persisting repository
changes, run:

```sh
stow -n .
devenv tasks run test:stow
devenv tasks run test:fish
```

For changes in `/Users/fbb/nixos`, identify the current host first and build its
configuration without switching it. Run repository formatting and linting only
for touched Nix files before a broader host build.

Record these observations for every canary package:

- Startup: the package loads at the pinned version without warnings.
- Authority: the tools and filesystem paths available to the package.
- Approval: representative allow, ask, and deny results.
- State: files created under `~/.pi` and their permissions.
- Failure: behavior when a companion process, server, or credential is absent.
- Rollback: successful startup after disabling only that package.

## Global Rollback

- Run `opencode`; its configuration and sessions remain untouched.
- Start Pi with `--no-extensions` to bypass third-party packages.
- Remove one package from the Pi invocation or package list to isolate failures.
- Keep package configuration inert during diagnosis rather than deleting state.
- Remove the Nix `pi` package only if the binary itself must be withdrawn.

The package audit behind this plan was static source and documentation review.
Runtime compatibility remains unverified until each canary phase is executed
locally.
