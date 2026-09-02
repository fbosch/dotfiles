# Pi Parity Next Steps

Complete the remaining OpenCode-to-Pi work in this order. Preserve OpenCode for
any workflow until its Pi replacement passes an independent live check.

## 1. Port Prompt-Only Commands

Add Pi command or prompt equivalents for:

- `.config/opencode/commands/commit-msg.md`
- `.config/opencode/commands/decision.md`
- `.config/opencode/commands/plan-tasks.md`
- `.config/opencode/commands/rmslop.md`

Keep each port independent and preserve the source command's inputs, output
contract, and safety constraints. The production `ai_commit` shell workflow is
already Pi-backed; `/commit-msg` remains here because no production caller used
it and its prompt contract is a separate migration slice.

Complete when each command is discoverable in Pi and passes a focused live
workflow without relying on OpenCode.

## 2. Decide Account-Routing Scope

Determine whether manual profile switching in
`.pi/agent/extensions/auth-profiles/` is sufficient.

If automatic routing is required, specify and implement the smallest Pi-native
replacement for the behavior in
`.config/opencode/plugins/openai-account-selector/`:

- Ordered account preferences.
- Usage-aware selection.
- Failed-account exclusion.
- Automatic quota failover.
- Model-alias handling.

Complete when the migration record either accepts manual switching as the Pi
contract or records live evidence for automatic selection and failover.

## 3. Keep OpenCode for Neovim Integration

Treat `.pi/agent/extensions/lsp/` as code-intelligence support, not as a
replacement for the OpenCode Neovim bridge.

Retain OpenCode until Pi independently supports and verifies the required
editor workflows:

- Unsaved-buffer reads.
- Visible window and buffer discovery.
- Visual selection context.
- Quickfix and location-list access.
- Reveal, highlight, and annotation actions.
- Clickable patch navigation.
- Neovim-owned session restoration.
- Editor and Herdr lifecycle coordination.

Complete when every workflow still in use has a tested Pi replacement. Do not
require exact parity for workflows that are explicitly retired.

## 4. Confirm Usage Before Optional Ports

Measure current use of these OpenCode-only capabilities before designing Pi
replacements:

- Azure DevOps PBI, test-case, and PR-review workflows.
- OpenMemory persistence.
- AGS desktop-pointer and screenshot-context workflows.

Port only capabilities with a current user. Azure DevOps requires a reviewed,
read-only Pi fetch integration before its command prompts are useful.

Complete when each capability is marked as retained, replaced, or retired with
the reason recorded in the main migration plan.

## 5. Exclude OpenCode Implementation State

Do not port OpenCode package manifests, lockfiles, caches, credentials,
sessions, logs, generated state, TUI configuration, or bootstrap helpers solely
to make the directory trees look alike.

Before declaring parity, verify behavior rather than matching file counts. Also
resolve the current `maxConcurrent: 6` setting in `.pi/agent/subagents.json`
against the original canary value of `1`; document the chosen operational
limit instead of treating it as a missing feature.
