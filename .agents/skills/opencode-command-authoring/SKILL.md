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
4. **Write prompt with shell context:** Use `` !`...` `` to inject project state instead of asking LLM to infer it.
5. **Test in TUI:** Invoke as `/command-name` and verify output format and tone.

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

### subtask: true

Use when:
- Command should run in isolation without polluting conversation history
- Long-running analysis that shouldn't block main session
- Produces structured artifact; result returned to main conversation

Example: analysis that takes 30 seconds and produces a JSON report.

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

❌ **Don't include Claude Code fields:**
```yaml
allowedTools: [bash, read]  # Silently ignored; don't clutter config
disable-model-invocation: true  # Ignored
```

❌ **Don't override built-in commands accidentally:**
```
Don't name: /init, /undo, /redo, /share, /help, /review
```

❌ **Don't assume LLM knows project state:**
```markdown
# Bad: "Tell me the current branch"
# Good: "Current branch: !`git rev-parse --abbrev-ref HEAD`"
```

❌ **Don't use $ARGUMENTS when structure would help:**
```markdown
# Bad: $ARGUMENTS (user guesses format)
# Better: $1 (type) and $2 (scope) with clear docs
```

❌ **Don't omit model override for strict-output:**
```yaml
# Bad: ask claude-opus to generate a commit message (overkill)
# Good: model: github-copilot/claude-haiku-4.5 (cheap, fast, deterministic)
```

## Reference Patterns

See `references/command-patterns.md` for four annotated archetypes:
1. **Strict output** — single-line, cheap model, heavy shell injection
2. **Structured report** — multi-section, shell metadata, output limits
3. **Workflow trigger** — build agent, test/lint integration
4. **Isolated subtask** — clean context, returns artifact

---

**Related:** Check existing commands in your repo for reference implementations.
