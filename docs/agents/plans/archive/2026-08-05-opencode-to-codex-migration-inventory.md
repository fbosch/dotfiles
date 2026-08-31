# OpenCode to Codex CLI Migration Inventory

This document records the current OpenCode setup, its likely Codex CLI replacement, and the migration order. It is based on the dotfiles-managed configuration and the effective local installations inspected on 2026-08-05.

## Scope and assumptions

- Target: Codex CLI only.
- Custom Codex extensions, hooks, MCP servers, and external integrations are assumed allowed.
- OpenCode is not used for migration validation.
- OpenCode configuration remains as static source material until Codex parity is demonstrated.
- Credentials, caches, session histories, generated state, `node_modules`, and lockfiles are not migration source.

## Executive summary

| Surface | Count or state |
| --- | --- |
| Explicit global instructions | 3 active, 1 inactive |
| Principal `AGENTS.md` layers | 2, plus subtree-specific files |
| Custom agents | 19 |
| OpenCode built-in agent overrides | 7 |
| Slash commands | 19 |
| Shared user skills | 49 |
| Skills requiring runtime-portability work | 13 |
| Active server plugins | 6 |
| Active TUI plugins | 3 |
| Custom tools | 10 |
| Direct MCP servers | 2 |
| Toolbox-managed MCP servers | 6 |
| Project references | 7 |

The migration has three distinct layers:

1. Prompt assets and repository rules are mostly portable.
2. MCP servers and command workflows are portable after interface adaptation.
3. OpenCode server/TUI plugins need Codex-specific replacements or should be retired.

OpenCode-specific plugins and named references are the main migration work. The 49 shared user skills are already on Codex's documented global skill path, `~/.agents/skills`; `.config/codex/skills` is an additional mirror, not the path Codex requires.

## Configuration topology

The canonical OpenCode source is managed in this repository and exposed through symlinks under `~/.config/opencode`.

| Effective path | Canonical source | Notes |
| --- | --- | --- |
| `~/.config/opencode/opencode.jsonc` | `.config/opencode/opencode.jsonc` | Global OpenCode configuration |
| `~/.config/opencode/agents/` | `.config/opencode/agents/` | Custom agents |
| `~/.config/opencode/commands/` | `.config/opencode/commands/` | Slash commands |
| `~/.config/opencode/instructions/` | `.config/opencode/instructions/` | Explicit instruction files |
| `~/.config/opencode/plugins/` | `.config/opencode/plugins/` | Server and TUI plugins |
| `~/.config/opencode/tools/` | `.config/opencode/tools/` | Custom tool implementations |
| `~/.config/opencode/mcp/` | `.config/opencode/mcp/` | Local MCP implementations |
| `~/.config/opencode/skills` | `.config/opencode/skills` -> `.agents/skills` | OpenCode skill surface |
| `opencode.json` | repository root | Project-level configuration |

Canonical shared skills live at `.agents/skills/`. The existing Codex mirror is:

```text
.config/codex/skills -> ../../.agents/skills
```

Codex CLI 0.146.0 uses `~/.codex` for global configuration and `~/.agents/skills` for global skills. Its current global `AGENTS.md` is empty, and it has only four Codex-specific OpenSpec prompts plus the app-provided `node_repl` MCP server.

## Instruction and policy inventory

The active explicit OpenCode instructions are configured in `.config/opencode/opencode.jsonc`.

| Source | Purpose | Codex disposition |
| --- | --- | --- |
| `.config/opencode/instructions/orchestration.md` | Routes work to specialized agents and defines delegation boundaries | Adapt to Codex multi-agent primitives |
| `.config/opencode/instructions/code-search.md` | Requires `fff` for indexed search and AST-grep for syntax-aware search | Adapt after equivalent MCP tools are registered |
| `.config/opencode/instructions/worktrunk.md` | Uses `wt` for worktrees and forbids mutating raw `git worktree` commands | Copy with minimal edits |
| `.config/opencode/instructions/shell-strategy.md` | Shell and tool strategy | Inactive; decide whether it remains useful |
| `AGENTS.md` | Repository-wide Stow, validation, plugin, and safety rules | Directly portable |
| `.config/opencode/AGENTS.md` | Global engineering rules and communication policy for the OpenCode subtree | Extract reusable parts into `~/.codex/AGENTS.md` |
| `.config/opencode/TONE.md` | Human-facing prose style | Portable on-demand reference |
| `.config/opencode/references/compatibility.md` | Compatibility policy | Portable on-demand reference |
| `.config/opencode/references/library-preferences.md` | Dependency selection policy | Portable on-demand reference |
| `.config/opencode/references/validation.md` | Validation and reporting policy | Portable on-demand reference |

Subtree-specific instructions should stay near their implementation sources:

- `.config/opencode/plugins/AGENTS.md`
- `.config/opencode/mcp/AGENTS.md`
- `.config/opencode/libexec/AGENTS.md`
- `design-system/AGENTS.md`

## Skills

There are 49 user-visible skills in `.agents/skills/`, plus the system-managed `.system/skill-installer`.

Most skill bodies are portable because they are prompt and workflow guidance. Tool-specific skills depend on restoring their external executable or MCP integration. Thirteen skills need either a runtime adapter, product-specific replacement, or wording cleanup before the shared tree can be treated as agent-agnostic.

| Skill | Disposition |
| --- | --- |
| `opencode-command-authoring` | Rewrite as Codex prompt-authoring guidance |
| `opencode-subagent-patterns` | Rewrite around Codex agent, permission, and delegation primitives |

The remaining skill families are largely directly portable:

| Family | Skills |
| --- | --- |
| Agent and workflow design | `agents-md-author`, `grill-me`, `grill-with-docs`, `improve-codebase-architecture`, `learning-opportunities`, `skill-creator`, `skill-judge`, `zoom-out` |
| Planning and quality | `api-and-interface-design`, `cli-ux`, `deep-modules`, `deprecation-and-migration`, `diagnose`, `hot-path-analysis`, `pr-description`, `security-and-hardening`, `tdd`, `test-pruner`, `thermo-nuclear-code-quality-review`, `to-issues`, `to-prd`, `triage` |
| Developer environments | `agent-browser`, `bun`, `devenv`, `herdr`, `justfile`, `linear`, `linear-issue-workflow`, `nix-run`, `openspec-*`, `worktrunk`, `wt-switch-create` |
| Languages and documentation | `ascii-visualizer`, `crafting-effective-readmes`, `github-actions-docs`, `jsdoc-typescript-docs`, `lua-config-authoring`, `ts-pattern`, `tsconfig`, `typescript-advanced-types`, `vercel-react-best-practices`, `vicinae-extension-authoring`, `writing-clearly` |

### Skill portability work

Keep explicitly product-specific skills as source-specific implementations rather than making their names promise portability:

| Skill | Disposition |
| --- | --- |
| `opencode-command-authoring` | Keep as OpenCode-specific source; create Codex command-authoring guidance separately |
| `opencode-subagent-patterns` | Keep as OpenCode-specific source; create Codex subagent guidance separately |
| `linear` | Keep Codex-specific MCP setup; split only if the Linear workflow must be shared with another host |
| `wt-switch-create` | Split portable Worktrunk lifecycle rules from Claude Code session-entry behavior |
| `ascii-visualizer` | Remove Claude-only frontmatter from the portable diagram guidance, or keep a Claude adapter separate |

Normalize accidental runtime assumptions in otherwise generic skills:

| Skill | Required change |
| --- | --- |
| `writing-clearly` | Resolve the tone reference through a neutral shared location instead of `~/.config/opencode/TONE.md` |
| `pr-description` | Refer to the active PR workflow and neutral tone reference instead of OpenCode command paths |
| `skill-creator` | Replace Claude-specific language with target-agent/model language |
| `skill-judge` | Evaluate knowledge relative to the target agent/model rather than Claude |
| `openspec-apply-change` | Replace exact question-tool naming with a host-neutral clarification capability |
| `openspec-propose` | Replace exact question and todo-tool naming with host-neutral interaction and progress capabilities |
| `openspec-archive-change` | Separate archive semantics from host-specific question, task, subagent, and skill invocation tools |
| `improve-codebase-architecture` | Request an exploration subagent when available; otherwise inspect directly |

External dependencies such as `wt`, `openspec`, Bun, Nix, Herdr, Linear, and browser automation are not agent coupling. Their prerequisites and failure behavior should remain explicit in the skills that use them.

## Agents

Nineteen custom agents are defined in `.config/opencode/agents/`.

| Agent | Responsibility | Codex disposition |
| --- | --- | --- |
| `adversarial` | Break designs and implementations with concrete reproducers | Port prompt and read-only constraints |
| `analyze` | Trace existing code with file and line evidence | Port |
| `backlog-planning` | Turn rough input into vertical-slice backlog plans | Port |
| `benchmark` | Measure and compare performance | Port |
| `commit` | Produce commit messages | Port as prompt/workflow |
| `debug` | Root-cause analysis | Port |
| `docs` | Documentation work | Port |
| `ideate` | Generate alternatives before convergence | Port |
| `lookup` | Narrow source-backed external lookup | Port |
| `patterns` | Find repository precedents | Port |
| `pr-feedback` | Triage and resolve PR review feedback | Port after GitHub MCP is restored |
| `quick` | Fast, bounded, deterministic work | Port |
| `refactor` | Behavior-preserving refactoring | Port |
| `research` | Multi-source investigation | Port |
| `review` | Bugs, risks, security, and maintainability review | Port |
| `spec` | Define explicit behavioral contracts | Port |
| `test` | Test design, execution, and diagnosis | Port |
| `tutor` | Teaching-oriented explanations | Port |
| `validate` | Bounded read-only validation | Port |

OpenCode-specific metadata cannot be copied directly:

- `mode`, colors, temperatures, step limits, and model IDs
- tool allowlists and ordered command permissions
- built-in agent override keys
- per-agent reasoning effort and text verbosity

The first Codex agent wave should be `explore`, `analyze`, `debug`, `review`, `test`, `validate`, and `quick`. These cover daily investigation, implementation support, and bounded verification.

### Subagent portability

Codex CLI supports custom subagents and parallel delegation as a stable feature. Custom agents are TOML files under `~/.codex/agents/` or `.codex/agents/`; each requires `name`, `description`, and `developer_instructions`. They can additionally set model, reasoning effort, sandbox mode, MCP servers, and skill configuration.

| Capability | OpenCode | Codex CLI | Migration result |
| --- | --- | --- | --- |
| Global roles | `~/.config/opencode/agents/*.md` | `~/.codex/agents/*.toml` | Supported with different format |
| Project roles | `.opencode/agents/*.md` | `.codex/agents/*.toml` | Supported with different format |
| Role prompt | Markdown body | `developer_instructions` | Direct semantic mapping |
| Description | YAML frontmatter | Required TOML property | Direct mapping |
| Per-agent model and reasoning | Provider-specific options | `model`, `model_reasoning_effort` | Supported, but not field-for-field |
| Read-only posture | Tool/permission maps | `sandbox_mode = "read-only"` | Coarse equivalent |
| Per-agent MCP and skills | Shared tools plus prompt routing | `mcp_servers`, `skills.config` | Supported after dependency migration |
| Parallel delegation | Task tool | Stable multi-agent workflow | Supported |
| Thread inspection and control | Task IDs and results | `/agent`, plus spawn/send/resume/wait/close operations | Supported |
| Per-command permission rules | Ordered command patterns | No direct per-agent equivalent | Keep host-specific |
| Tool allowlists, colors, hidden roles, temperatures, step limits | OpenCode frontmatter | No direct equivalent | Keep host-specific or retire |
| Primary versus subagent role | `mode` | No direct per-agent equivalent | Model primary behavior through prompts, profiles, or skills |

Codex built-ins are `default`, `worker`, and `explorer`. They are not aliases for the current OpenCode role names. Preserve the nineteen named roles as custom Codex agents where they remain useful; use Codex built-ins only for their broad default purpose.

The agent prompt bodies have three portability classes:

| Class | Roles | Required work |
| --- | --- | --- |
| Direct body reuse | `commit`, `ideate`, `refactor` | Copy the instruction body; add an explicit Codex sandbox/profile only when needed |
| Reuse after skill validation | `adversarial`, `benchmark`, `review`, `spec`, `test` | Retain substantive workflow after confirming named skills are available |
| Adapt tool/routing vocabulary | `analyze`, `backlog-planning`, `debug`, `docs`, `lookup`, `patterns`, `pr-feedback`, `quick`, `research`, `tutor`, `validate` | Replace literal OpenCode tools, reference syntax, and task routing with configured Codex capabilities |

Use a host-neutral source of truth instead of trying to share a physical file between OpenCode and Codex.

```text
.agents/roles/
  analyze.md
  review.md
  test.md

.agents/role-overrides/
  opencode.yaml
  codex.yaml
```

The shared role source should contain only the demonstrated intersection:

```text
name: string
description: string
developer_instructions: markdown
access: read-only | workspace-write
model-tier: fast | balanced | deep
capabilities: semantic names such as code-search, external-docs, github-review
skills: skill names
```

The host adapters resolve the semantic fields:

| Concern | OpenCode adapter | Codex adapter |
| --- | --- | --- |
| Role registration | YAML frontmatter plus Markdown | TOML custom agent |
| Read-only role | Tool and permission deny rules | Read-only sandbox or permission profile |
| `code-search` capability | `fff` and Toolbox AST-grep | Configured `fff` and AST-grep MCP servers |
| `external-docs` capability | Context7, Exa, web tools | Configured MCP or native web capability |
| `github-review` capability | `gh_pr_feedback_*` tools | Migrated workflow MCP tools |
| Model tier | OpenCode provider/model settings | Codex model and reasoning-effort settings |

Keep these fields outside the canonical role definition: OpenCode `mode`, color, temperature, steps, hidden state, prompt field, tool maps, and command permissions; Codex concrete model IDs, sandbox/permission profile, MCP configuration, and skill configuration.

The security boundary needs explicit treatment. OpenCode per-agent command rules such as `git commit *: deny` do not map to Codex role files. A Codex child inherits the parent turn's active sandbox and approval choices, so an agent definition cannot be treated as an independent privilege boundary. Use the shared role source for intent, Codex sandbox or permission profiles for broad enforcement, and global rules or execution policy for command restrictions.

## Commands

Nineteen OpenCode commands are defined in `.config/opencode/commands/`.

| Command | Purpose | Codex disposition |
| --- | --- | --- |
| `ado-pbi` | Fetch and format an Azure DevOps backlog item | Prompt plus ADO MCP tool |
| `ado-pr-review` | Review an Azure DevOps PR | Prompt plus ADO MCP tool |
| `ado-test-case` | Fetch and format an ADO test case | Prompt plus ADO MCP tool |
| `commit-msg` | Produce a Commitizen-style message from staged changes | Prompt |
| `decision` | Create the next numbered ADR | Prompt plus safe helper logic |
| `fix-ci` | Diagnose or fix current CI failures | Prompt plus CI MCP tool |
| `gh-pr-feedback` | Retrieve and address GitHub review feedback | Prompt plus GitHub workflow MCP tool |
| `linear-issue` | Execute a Linear delivery workflow | Prompt plus Linear integration |
| `open-pr` | Open a GitHub or Azure DevOps PR | Prompt plus PR MCP tool |
| `opsx-apply` | Apply OpenSpec tasks | Compare and converge with existing Codex prompt |
| `opsx-archive` | Archive an OpenSpec change | Compare and converge with existing Codex prompt |
| `opsx-explore` | Explore an OpenSpec change | Compare and converge with existing Codex prompt |
| `opsx-propose` | Propose an OpenSpec change | Compare and converge with existing Codex prompt |
| `plan-tasks` | Create a structured backlog plan | Prompt/agent workflow |
| `pr-desc` | Write a PR title and description | Prompt plus `pr-description` skill |
| `resolve-conflicts` | Resolve safe merge conflicts | Prompt with Git safety rules |
| `rmslop` | Remove low-value AI-generated code | Prompt |
| `toolbox-status` | Report Toolbox/MCP health | Replace with Codex MCP diagnostics |
| `yank` | Copy previous assistant output to clipboard | Optional shell helper or retire |

The four OpenSpec prompts already exist in `~/.codex/prompts/`. They are a useful Codex prompt format reference, but should be compared against the OpenCode versions before being declared equivalent.

OpenCode command features that need conversion include `$ARGUMENTS`, positional arguments, shell interpolation, file inclusion, agent selection, model selection, and OpenCode-specific tool names.

## Plugins and custom tools

### Active server plugins

Configured in `.config/opencode/opencode.jsonc`.

| Plugin | Current capability | Codex disposition |
| --- | --- | --- |
| `opencode-toolbox@0.10.4` | Lazy discovery and execution of external MCP tools | Replace with native Codex MCP registration where practical |
| `hyprland/hyprland.ts` | `hypr_window_screenshot` using CDP and `grim` fallbacks | Repackage as local MCP server |
| `direnv/direnv-session-env.ts` | Loads `.envrc` per session and applies it to shell calls | Codex hook or launch wrapper |
| `ado-fetch/ado-fetch.ts` | Typed ADO PR, PBI, and test-case retrieval | Merge into developer workflow MCP server |
| `opencode-handoff/handoff.ts` | Session handoffs, transcript reading, synthetic file injection | Start with Codex `fork` and `resume`; rebuild only missing behavior |
| `openai-account-selector/openai-account-selector.ts` | Repository-specific OAuth profile selection and quota failover | Prefer Codex-native authentication; rebuild only missing selection behavior |

### Active TUI plugins

Configured in `.config/opencode/tui.json`.

| Plugin | Current capability | Codex CLI disposition |
| --- | --- | --- |
| `current-port/current-port.tsx` | Displays OpenCode server port and selected profile | Retire unless a concrete status need remains |
| `neovim-integration/neovim-integration.tsx` | Session ID sync, patch navigation, Herdr lifecycle/title reporting | Split into Codex-compatible editor and helper integrations |
| `prompt-enhancements/prompt-enhancements.tsx` | Prompt typo correction and native-usage coloring | Move correction to editor/shell; retire usage coloring unless Codex exposes a stable hook |

### Custom tool inventory

| Tool | Capability | Dependencies | Codex disposition |
| --- | --- | --- | --- |
| `ci_failure_context` | Inspects GitHub or Azure DevOps CI, including failing logs | `git`, `gh`, `az` | Local MCP |
| `gh_pr_feedback_context` | Retrieves actionable unresolved GitHub review threads | Bun, `gh` | Local MCP |
| `gh_pr_feedback_resolve_threads` | Comments on and resolves GitHub review threads | Bun, `gh` | Local MCP |
| `open_pr` | Detects provider, pushes branch, creates a PR, can request Codex review | `git`, `gh`, `az` | Local MCP with approval boundary |
| `update_pr` | Finds and updates the active PR | `git`, `gh`, `az` | Local MCP with approval boundary |
| `ado_fetch` | Fetches ADO PR, PBI, or test-case data without shell interpolation | Bun, Bash, Azure helpers | Local MCP |
| `handoff_session` | Creates an editable OpenCode handoff session | OpenCode session/TUI API | Rebuild only if Codex session features are insufficient |
| `read_session` | Reads an OpenCode session transcript | OpenCode session API | Replace with Codex session operations if supported |
| `openai_account_preferences` | Reports repository account preferences and selected profile | OpenCode account selector | Replace or retire |
| `hypr_window_screenshot` | Captures contextual Hyprland screenshots | `hyprctl`, `grim`, Wayland, optional CDP | Local MCP |

The provider-neutral developer workflow tools are cohesive enough to become one local MCP server rather than separate one-off hooks.

### Inactive or experimental implementations

These implementations are present but not explicitly enabled. They should not block the first migration.

| Source | Capability | Recommendation |
| --- | --- | --- |
| `plugins/openmemory/` | Persistent profile/project memory, context injection, memory-aware compaction | Evaluate Codex native memory first |
| `plugins/context-images/` | Replaces large plaintext context with rendered image packages | Defer; high complexity and currently inactive |
| `plugins/rtk/` | Rewrites shell commands through `rtk rewrite` | Consider a Codex hook only after measuring value |
| `plugins/machine-context/` | Machine/context metadata | Defer pending a concrete need |
| `plugins/headroom-opencode-transport/` | Injects Headroom proxy environment variables | Use standard Codex environment configuration or retire |
| `plugins/ai-commit/` | AI-assisted commit helper | Consolidate with `commit-msg` |
| `plugins/ai-pr/` | AI PR helper | Consolidate with PR tools |
| `plugins/just-bash/` | Only generated dependency state remains | Retire |
| `plugins/neovim-herdr-agent/` | Only analysis state remains | Retire as standalone source |
| `plugins/neovim-session-sync/` | Only analysis state remains | Retire as standalone source |
| `plugins/worktrunk/` | Only generated dependency state remains | Retire; keep Worktrunk instructions and skill |

## MCP inventory

### Direct OpenCode MCP servers

| Server | Capability | Codex disposition |
| --- | --- | --- |
| `fff` | Indexed path, identifier, and multi-pattern search | Register directly |
| `neovim` | Live buffer, diagnostics, selection, quickfix, reveal, highlights, and annotations via fixed socket | Register directly after removing OpenCode-specific environment naming |

The Neovim MCP implementation is largely reusable. Its main coupling is the `OPENCODE_NVIM_SOCKET` launch environment variable and the OpenCode-specific config path.

### Toolbox-managed MCP servers

| Server | Capability | Runtime requirements |
| --- | --- | --- |
| `github` | GitHub MCP via `gh mcp` | `gh` |
| `context7` | Library/documentation lookup | Podman, `mcp/context7` image |
| `exa` | Web search and retrieval | Podman, `EXA_API_KEY` |
| `serena` | Semantic code navigation | Podman, project mount, persistent volume |
| `ast-grep` | Read-only syntax-aware code search | Podman, pinned image |
| `chrome-devtools` | Headless browser/DevTools automation | Podman, Playwright image |

Codex CLI supports native MCP registration, so the Toolbox plugin does not need to be ported. The decision is whether native always-available registrations are acceptable or whether lazy discovery is worth rebuilding.

## References and project context

`opencode.json` exposes these project references:

```text
nixos
vicinae-docs
ags-docs
hyprland-docs
waybar-docs
glance-docs
herdr-docs
```

Codex has no OpenCode-style named-reference registry or `@alias` autocomplete. Its equivalent is composed from several layers:

- `AGENTS.md` for a small, always-on reference index and when-to-read guidance.
- Global `~/.agents/skills` and repository `.agents/skills` for reusable workflows with deferred `references/` content.
- `--add-dir` or sandbox configuration when Codex needs filesystem access outside the workspace.
- MCP resources for dynamic, remote, or centrally managed reference material.

Use a concise reference index in `AGENTS.md` for the existing local documentation trees, and have skills name their own documentation dependencies. The documentation repositories provide `TOC.md` entry points.

## Models, profiles, and permissions

OpenCode stores six routing profiles in `.config/opencode/profiles.jsonc`:

```text

These route individual agent roles across OpenAI, Anthropic, GitHub Copilot, and OpenCode Zen models. Codex CLI currently uses `gpt-5.4` and supports layered config profiles through `codex -p`, but it cannot consume the OpenCode profile definition directly.

Keep only approved Codex/OpenAI profiles initially. Do not carry OpenCode Zen, Copilot, or Anthropic routing forward unless separately approved.

OpenCode's ordered command-level permissions also cannot be translated directly. Preserve the safety outcomes with:

```text
sandbox: workspace-write
approval: on-request
additional writable directories: explicit only
AGENTS.md: no commits, pushes, rebases, destructive operations, or PR creation without explicit user request
hooks: only for enforcement that instructions cannot reliably provide
```

## Phased migration plan

Each phase should finish with a visible Codex CLI outcome.

### 1. Establish a Codex source of truth

Outcome: Codex starts from a dotfiles-managed `~/.codex` configuration without capturing generated state.

- Decide which existing `.codex` files are versioned source.
- Version `config.toml`, `AGENTS.md`, prompts, user skills, and custom integration source.
- Exclude auth files, SQLite databases, logs, caches, history, sessions, memories, installation IDs, shell snapshots, and marketplace caches.
- Keep `~/.agents/skills` as the global user-skill source and verify Codex discovers it.
- Keep system-managed Codex skills separate from user skills.

### 2. Port global rules and make shared skills portable

Outcome: A new Codex session loads global engineering rules and uses shared skills without following OpenCode or Claude-only behavior.

- Extract reusable rules from `.config/opencode/AGENTS.md` into `~/.codex/AGENTS.md`.
- Preserve repository `AGENTS.md` unchanged where possible.
- Port compatibility, validation, library, and tone references.
- Verify Codex discovers the 49 canonical user skills from `~/.agents/skills`.
- Keep the two OpenCode authoring skills as product-specific source material; create Codex replacements instead of modifying them in place.
- Split Claude Code session-entry behavior from `wt-switch-create`.
- Normalize the eight generic skills that currently name OpenCode, Claude, or host-specific tools.
- Retain `agents/openai.yaml` files as Codex adapters where they declare Codex MCP dependencies; do not make the shared skill body depend on their presence.
- Validate one generic skill, one Codex/MCP-backed skill, and one skill with a former host-specific assumption.

### 3. Restore code search and editor context

Outcome: Codex can use `fff`, AST-grep, and live Neovim context.

- Register `fff` directly in Codex MCP configuration.
- Register AST-grep directly, or preserve Toolbox only if lazy discovery proves necessary.
- Port the Neovim MCP launch command and use a neutral socket environment variable.
- Adapt `code-search.md` to Codex tool names.
- Verify search, diagnostics, visual selection, quickfix, and source reveal.

### 4. Port read-only developer workflow tools

Outcome: Codex can inspect CI, PR feedback, PR context, and ADO items without mutating remote state.

- Build one local MCP server around CI inspection, GitHub feedback retrieval, PR context, and ADO fetch logic.
- Reuse provider detection and helpers from the existing source.
- Remove `@opencode-ai/plugin` coupling.
- Keep mutation tools disabled during this phase.
- Validate against GitHub and Azure DevOps repositories where both are required.

### 5. Enable controlled PR mutations

Outcome: Codex can resolve review threads and create or update PRs with explicit approval.

- Add GitHub thread resolution, `open_pr`, and `update_pr` to the workflow MCP server.
- Preserve provider detection, branch validation, base detection, and the committed-changes requirement.
- Keep remote mutation behind Codex approval boundaries.
- Preserve the optional GitHub `@codex review` request.
- Validate context-only behavior before a live mutation.

### 6. Port high-value prompts

Outcome: Daily command workflows are available to Codex.

Priority order:

1. `plan-tasks`
2. `pr-desc`
3. `fix-ci`
4. `gh-pr-feedback`
5. `open-pr`
6. `linear-issue`
7. ADO commands
8. `commit-msg`
9. `decision`
10. `resolve-conflicts`
11. `rmslop`

Replace OpenCode interpolation and tool calls with explicit Codex prompt and MCP behavior. Reuse skills instead of duplicating policy text.

### 7. Port agent roles through shared semantic definitions

Outcome: Codex delegates specialist roles generated from a single host-neutral source, with verified sandbox, skill, and MCP behavior.

1. Create a canonical role source under `.agents/roles/` with only name, description, instructions, access posture, semantic capabilities, and skill dependencies.
2. Keep OpenCode execution metadata in an OpenCode adapter and Codex execution metadata in a Codex adapter. Do not put colors, temperature, steps, OpenCode permissions, or concrete Codex model IDs in the shared role source.
3. Render each Codex role as a TOML file under `~/.codex/agents/` or `.codex/agents/`, with `name`, `description`, and `developer_instructions` as required fields.
4. Map semantic capabilities to verified host integrations before retaining them in a role prompt:
   - `code-search` -> configured search and AST MCP servers
   - `external-docs` -> configured documentation/search MCP servers or native web capability
   - `github-review` -> migrated PR workflow MCP tools
5. Translate OpenCode tool names, `@` reference syntax, and task-routing language in the eleven tool-dependent roles. Preserve workflow intent and output contracts.
6. Configure Codex global multi-agent policy separately from role definitions: enabled state, concurrent-thread limit, default model, default reasoning effort, and interruption behavior are policy decisions, not inferable from the OpenCode files.
7. Use read-only sandbox or a read-only permission profile for roles that explicitly prohibit edits. Make write-capable role access explicit rather than deriving it from the absence of OpenCode deny rules.
8. Validate the first representative roles:
   - `analyze` for evidence-based read-only exploration
   - `review` for read-only skill routing
   - `test` for workspace-write validation and test creation
   - `pr-feedback` for approval-sensitive GitHub review mutation after workflow MCP tools exist
9. Validate parallel delegation, `/agent` thread inspection, steering, interruption, unavailable capability failures, and parent sandbox/approval inheritance.
10. Add a drift check that detects OpenCode-only tool names, unconfigured MCP dependencies, unavailable skills, and divergence between the canonical role source and generated adapters.

First role wave:

```text
analyze
debug
review
test
validate
quick
```

Second role wave:

```text
adversarial
backlog-planning
benchmark
docs
ideate
lookup
patterns
pr-feedback
refactor
research
spec
tutor
```

Treat `commit` as a prompt or skill first. It only needs a dedicated Codex agent when delegation materially improves the workflow.

### 8. Restore environment and worktree ergonomics

Outcome: Codex commands run with project environment and Worktrunk rules.

- Port direnv session behavior with a Codex hook or launch wrapper.
- Keep Worktrunk instructions and skills.
- Confirm shell snapshots do not prevent direnv refresh.
- Add RTK rewriting only after measuring a useful token or output reduction.

### 9. Replace session and TUI integration selectively

Outcome: Required session continuation and editor behavior work without recreating the OpenCode TUI.

- Start with Codex `fork`, `resume`, archive, and session operations instead of porting handoff code.
- Add a handoff prompt that produces a concise continuation brief and file list.
- Preserve Neovim patch navigation only if Codex exposes a stable integration point.
- Move typo correction outside Codex if there is no CLI input hook.
- Retire current-port display unless it has a concrete diagnostic use.
- Keep Herdr lifecycle behavior only if it remains part of the CLI workflow.

### 10. Evaluate optional functionality

Outcome: Every inactive OpenCode feature has an explicit keep, replace, or retire decision.

Evaluation order:

```text
Codex native memory versus OpenMemory
context-images
RTK rewriting
machine context
Headroom transport
AI commit/PR duplicate helpers
```

### 11. Cut over and audit

Outcome: Daily workflows use Codex CLI without hidden OpenCode runtime dependencies.

- Search shell, Neovim, Herdr, Navi, and helper scripts for `opencode` invocations.
- Replace only the invocations required by migrated workflows.
- Run the acceptance checklist below in Codex.
- Keep OpenCode source archived until required workflows pass.
- Document each intentionally retired feature.

## Acceptance checklist

The migration is complete when Codex CLI can demonstrably:

- Load global and repository `AGENTS.md` rules.
- Discover and load canonical user skills.
- Search files and code through `fff`.
- Perform AST-aware searches.
- Read Neovim buffers, diagnostics, selections, and quickfix state.
- Use Worktrunk rather than mutating raw Git worktrees.
- Load direnv project environments.
- Inspect GitHub and Azure DevOps CI.
- Retrieve and resolve GitHub review feedback.
- Fetch ADO PR, PBI, and test-case context.
- Generate PR descriptions.
- Create and update PRs with approval.
- Run OpenSpec workflows.
- Delegate review, debugging, testing, analysis, and validation work.
- Continue work through a Codex-native session workflow.
- Operate without loading or executing OpenCode.
