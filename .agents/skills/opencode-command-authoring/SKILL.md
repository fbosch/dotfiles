---
name: opencode-command-authoring
description: Author OpenCode custom slash commands as markdown files. Use when creating, editing, or reviewing commands in ~/.config/opencode/commands/ or .opencode/commands/. Covers frontmatter (description, model, agent, subtask), prompt syntax (!`shell`, $ARGUMENTS, @file), design principles, and archetypes for strict-output, structured-report, workflow-trigger, and isolated-subtask commands.
---

# OpenCode Command Authoring

Guide for creating high-quality custom slash commands in OpenCode. Commands are `.md` files invoked as `/command-name` in the TUI.

## Quick Reference

**Locations:**
- Global: `~/.config/opencode/commands/<name>.md`
- Per-project: `.opencode/commands/<name>.md`

**Invocation:** `/command-name` in OpenCode TUI

**Built-in commands** (do not override): `/init`, `/undo`, `/redo`, `/share`, `/help`, `/review`

## Frontmatter Specification

Only these four fields are parsed. All other fields (allowedTools, disable-model-invocation, etc.) are silently stripped.

```yaml
---
description: string   # Optional. Shown in TUI autocomplete
model: string         # Optional. Override model: "provider/model-id"
agent: string         # Optional. Which agent: build, plan, explore, or custom
subtask: boolean      # Optional. Force subagent isolation (clean context)
---
```

**Never include:** `allowedTools`, `disable-model-invocation`, `context`, or other Claude Code fields.

## Prompt Syntax

### Shell Injection
`` !`shell command` `` — Executes at invocation time; output injected before LLM sees prompt. Runs in project root.

```markdown
Branch: !`git rev-parse --abbrev-ref HEAD`
Staged diff: !`git diff --cached`
```

### Arguments
- `$ARGUMENTS` — Everything user typed after `/command-name`
- `$1`, `$2`, `$3` — Positional arguments (space-separated)

### File Inlining
`@path/to/file` — Inlines file contents at that location in the prompt.

```markdown
Current config:
@.eslintrc.json
```

## Authoring Workflow

1. **Define scope:** Global command (universal workflow) or per-project (domain-specific)?
2. **Choose agent & model:** See decision guide below.
3. **Design output format:** Strict single-line? Structured report? Free-form analysis?
   → If unsure which pattern fits, read `references/command-patterns.md` before writing.
   → If you already know the pattern (commit message, PR desc, etc.), skip it.
4. **Write prompt with shell context:** Use `` !`...` `` to inject project state instead of asking LLM to infer it.
5. **Test in TUI:** Invoke as `/command-name` and verify output format, model indicator, and edge cases (empty diff, no args).

## Decision Guide

### Agent Selection

| Agent | Behavior | Use Case |
|-------|----------|----------|
| `build` (default) | Full tool access, file writes allowed | Commands that modify code, create files, make changes |
| `plan` | Read-only analysis, no writes | Design reviews, code analysis, planning |
| `explore` | Fast read-only codebase search | Quick lookup, grep-style queries |
| (omit) | User's current agent | Flexible; inherit from active session |

### Model Selection

- **Override to cheap/fast model** (e.g., `github-copilot/claude-haiku-4.5`) when:
  - Output is deterministic/formulaic (commit messages, PR titles, code formatting)
  - Task is strict constraint-based (single-line output, max N characters)
  - Speed matters more than reasoning depth

- **Omit `model`** when:
  - Task requires complex reasoning or code understanding
  - Output varies widely based on context
  - Quality justifies latency

### subtask: true — What Gets Isolated

The subagent runs in a **fresh session**. It has:
- No conversation history from the parent
- No files the parent opened or read
- No awareness of what the user was working on
- Its own tool permissions (inherits agent config, not parent session state)

It **does** receive:
- The rendered prompt (after `!` injection and `$ARGUMENTS` substitution)
- Full access to the project filesystem
- All configured MCP tools

**Use when:** The command is self-contained — it derives all needed context from the filesystem or shell output, and its output (a report, JSON artifact, analysis) should be returned to the main session without polluting it.

**Do NOT use when:** The command needs to reference what the user was discussing, files already open in context, or decisions made earlier in the session. The subagent has none of that.

### Scope Decision

| Level | When | Example |
|-------|------|---------|
| Global (~/.config/opencode/commands/) | Universal workflow, used across projects | commit-msg, pr-desc, git operations |
| Per-project (.opencode/commands/) | Domain-specific, only useful in this repo | generate-api-docs, run-domain-tests |

## Design Principles

### 1. Output Discipline
For strict-output commands (commit messages, PR titles, etc.):
```markdown
**Output:** ONLY the commit message. First character must be type. No markdown, no explanations.
```

### 2. Shell Context Over Guessing
Inject live state instead of asking LLM to infer:
```markdown
!`git diff --cached`  ← Better than asking LLM to guess staged changes
!`git log -1 --pretty=format:"%s"`  ← Better than asking LLM to know commit history
```

### 3. Argument Design
- Use `$ARGUMENTS` for simple passthrough (e.g., user-provided description)
- Use `$1`, `$2`, `$3` when command takes structured positional inputs
- Document expected format clearly

### 4. Length Constraints
For strict-output commands, include explicit limits:
```markdown
Commit message (≤50 chars): format is `<type>(<scope>): <subject>`
PR title (≤72 chars): concise, future-tense verb
```

### 5. Scope Clarity
Document what the command does and when to use it. Avoid overlap with built-ins.

## Anti-Patterns

❌ **`!` shell injection runs at invocation, not at LLM time — empty output is silent**
If `git diff --cached` returns nothing (nothing staged), the LLM receives a blank diff
and generates a generic or hallucinated commit message with no error. Guard against it:
```markdown
STAGED DIFF:
!`git diff --cached || echo "(nothing staged — run git add first)"`
```

❌ **`$ARGUMENTS` is silently empty when user invokes with no args**
The LLM receives a blank substitution with no warning. If the command requires args,
enforce it explicitly in the prompt body:
```markdown
If $ARGUMENTS is empty, respond only: "Usage: /command-name <description>"
```

❌ **`agent: plan` does NOT restrict bash tool use**
`plan` prevents file writes but the agent can still run bash commands. If you need
to restrict tool access, define a custom agent with `permission: { bash: deny }`.

❌ **`subtask: true` inherits NO parent context — pass everything explicitly**
The subagent starts cold: no conversation history, no files the parent opened, no
awareness of what the user was working on. Everything it needs must come from
shell injection or `@file` includes in the prompt body.

❌ **Model IDs are not validated at parse time — typos silently fall back**
A misspelled `model:` value falls back to the default model with no warning or error.
Verify by checking the model indicator in the TUI after the first invocation.

❌ **Don't include Claude Code fields — they are silently stripped, not errors**
```yaml
allowedTools: [bash, read]       # Parsed then discarded; no effect
disable-model-invocation: true   # Same
```
The OpenCode `Command` Zod schema only parses: `description`, `model`, `agent`, `subtask`.

## Reference Patterns

See `references/command-patterns.md` for four annotated archetypes:
1. **Strict output** — single-line, cheap model, heavy shell injection
2. **Structured report** — multi-section, shell metadata, output limits
3. **Workflow trigger** — build agent, test/lint integration
4. **Isolated subtask** — clean context, returns artifact

---

**Related:** Check existing commands in your repo for reference implementations.
