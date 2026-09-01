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
- Auth profiles: `@nanstey/pi-auth-profiles@0.1.1`.
- Usage identity: `@narumitw/pi-usage@0.59.0`, introduced after profiles.
- Plan mode: `@narumitw/pi-plan-mode@0.56.0`, introduced after permissions.
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
- Direnv: `pi-direnv@0.1.0` because it mutates process-wide environment.
- Azure DevOps: `@patimweb/pi-azure-devops@2.0.1` because target-specific safety
  can be bypassed.
- Web tools: `pi-web-kit@0.2.4` because it is outdated and duplicates retained
  tools.

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
Toolbox configuration. Add Context7, Exa, GitHub, ast-grep, Serena, and
chrome-devtools separately only after each preceding server passes.

Keep FFF as a Pi package rather than exposing a second FFF implementation
through MCP.

Acceptance:

- The model sees one MCP proxy tool rather than every server tool.
- The server starts lazily.
- Read-only calls work.
- Mutating MCP tools remain approval-gated.
- Host MCP configuration is not silently imported.

Rollback:

- Remove the adapter package or the individual server declaration.

Context7 MCP canary outcome on 2026-09-01:

- Installed and pinned `pi-mcp-adapter@2.31.0` with package skills disabled.
  npm reported zero vulnerabilities and no additional install scripts were
  approved.
- Configured `directTools: false`, `hostConfigDiscovery: "off"`, and
  `scriptMode: false`. Pi exposed one MCP tool, `mcp`, and did not expose
  `mcpScript` or individual server tools.
- Added only Context7, running under rootless Podman with a read-only
  filesystem, all capabilities dropped, and `no-new-privileges`.
- Pinned the multi-architecture Context7 image to
  `sha256:1174e6a29634a83b2be93ac1fefabf63265f498c02c72201fe3464e687dd8836`.
  Cosign verified the image against Docker's MCP public key and transparency
  log.
- Confirmed the merged adapter configuration contains only the Context7 server
  and keeps host-specific discovery off.
- Confirmed an idle Pi session does not start the lazy Context7 container.
- Confirmed normal headless use fails closed with `approval required` before an
  MCP call runs.
- Loaded only the adapter for functional isolation and resolved Bun to
  `/oven-sh/bun` through Context7. The container stopped after the session.
- Ignored adapter metadata and onboarding state under `~/.pi/agent`; neither
  contains declarative configuration.
- Confirmed `pi --no-extensions` starts without the `mcp` tool.

## Phase 5: Canary Manual Auth Profiles

Add:

```text
@nanstey/pi-auth-profiles@0.1.1
@narumitw/pi-usage@0.59.0
```

Create two isolated profiles through Pi. Switch them manually and verify the
actual account with `/usage`. Do not add repository profile mappings during this
phase.

This phase intentionally defers behavior implemented by
`.config/opencode/plugins/openai-account-selector/selection.ts`:

- Ordered repository account preferences.
- Alias resolution.
- Usage-aware selection.
- Exclusion after a failed account.
- Automatic quota failover.
- A persistent selected-profile indicator.

Acceptance:

- Credentials remain isolated by profile.
- Switching profiles changes the real provider account.
- `/usage` follows the active profile without leaking cached state from the
  previous account.
- Restarting Pi preserves the documented profile selection.

Rollback:

- Return to Pi's first-party single credential.
- Keep OpenCode as the path for automatic repository routing and failover.

## Phase 6: Add Plan Mode and One Subagent

Canary `@narumitw/pi-plan-mode@0.56.0` with no `safeSubcommands` and no custom
plan tools. Test direct writes, shell redirection, command chains, Git
mutations, and build hooks.

After plan mode passes, add `@gotgenes/pi-subagents@21.0.3` with
`maxConcurrent: 1`. Start with one read-only `Explore` agent, an explicit tool
allowlist, and restrictive permission frontmatter. Keep the permission extension
loaded in children so approval requests can reach the parent UI.

Do not port all 19 OpenCode agents. Pi skills already cover most specialization.
Add another role only after a real task demonstrates that a dedicated agent
improves the result or feedback loop.

Acceptance:

- Plan mode blocks direct and shell-mediated mutations.
- Unknown shell forms fail closed.
- The read-only child cannot write or run mutating commands.
- Child approval requests reach the parent UI.
- Interrupting a child settles or terminates it predictably.

Rollback:

- Remove the subagent package before removing the permission package.
- Keep plan mode only if its enforcement passed independently.

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

## Phase 8: Keep Direnv Process-Scoped

Do not install `pi-direnv@0.1.0`. It mutates `process.env`, does not restore a
baseline, and can carry stale or secret values into later sessions.

Start a fresh Pi process from each project's direnv-activated shell. Do not
reuse that process across projects with different environments.

Rebuild session-scoped environment injection only if this operating rule becomes
a measured problem. A replacement must preserve the current OpenCode invariant:
environments are keyed by session and applied only to tool subprocesses.

Acceptance:

- Moving between repositories with different `.envrc` files never reuses the
  same Pi process.
- Environment values from one repository are absent from a fresh process started
  in another.

Rollback:

- No package state exists to remove.

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
