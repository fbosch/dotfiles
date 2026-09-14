# OpenCode Agent Configuration

## Built-in agents

OpenCode includes these built-in subagents:

| Agent     | Mode     | Capabilities                          | Use for                                                         |
| --------- | -------- | ------------------------------------- | --------------------------------------------------------------- |
| `general` | subagent | Read and write; all tools except todo | Complex research, multi-step operations, and code modifications |
| `explore` | subagent | Read-only; Glob, Grep, Read, Bash     | Fast codebase exploration without changes                       |

They can also be invoked with `@general` and `@explore`.

## Custom agent locations

| Type    | Location                     | Scope           | Priority |
| ------- | ---------------------------- | --------------- | -------- |
| Project | `.opencode/agents/`          | Current project | Highest  |
| User    | `~/.config/opencode/agents/` | All projects    | Lower    |

A project agent wins when names conflict.

## Configuration methods

### Interactive creation

```bash
opencode agent create
```

The command asks where to save the agent, what it should do, which tools it needs, and then creates the configuration.

### JSON configuration

Add an agent under `agent` in `opencode.json`:

```json
{
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for quality and potential issues. Use after code changes.",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "tools": {
        "read": true,
        "grep": true,
        "glob": true,
        "bash": false
      }
    }
  }
}
```

### Markdown configuration

Place the agent at `.opencode/agents/<name>.md` or `~/.config/opencode/agents/<name>.md`. The filename becomes the agent name.

```markdown
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
tools:
  read: true
  grep: true
  glob: true
  bash: false
---

Review code quality, edge cases, performance, and security. Provide actionable findings without making changes.
```

## Configuration fields

Required:

- `description`: What the agent does and when to use it.
- `mode`: `subagent`, `primary`, or `all`.

Optional:

- `model`: An explicit model ID; omitted means inherit from the primary agent.
- `temperature`: A value from `0.0` to `1.0` when supported by the model.
- `tools`: An allowlist of enabled tools; omit it to inherit all tools.
- `permission`: Permissions for `edit`, `bash`, `webfetch`, or `task`.
- `prompt`: A custom system prompt file path relative to the config.
- `hidden`: Hide a subagent from `@` autocomplete.
- `color`: A hex or theme color.
- `steps`: Maximum agentic iterations before a text-only response.

### Example with all options

```json
{
  "agent": {
    "security-auditor": {
      "description": "Performs security audits. Use proactively for security reviews.",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.1,
      "tools": {
        "read": true,
        "grep": true,
        "glob": true,
        "bash": false,
        "write": false,
        "edit": false
      },
      "permission": {
        "bash": "deny",
        "edit": "deny"
      },
      "color": "error"
    }
  }
}
```

## Common configured agents

### Code review agent

```markdown
---
description: Reviews code for quality, security, and best practices. Use after code changes.
mode: subagent
tools:
  read: true
  grep: true
  glob: true
  bash: false
---

Review code quality, security, performance, and edge cases. Provide specific, actionable feedback without making direct changes.
```

### Test runner agent

A test runner needs write access to fix failures and bash access to execute the project's tests. Restrict its bash permissions to approved test commands when the host supports command-specific permissions.

### Documentation writer

A documentation writer generally needs `read`, `write`, `edit`, `glob`, `grep`, and optionally `webfetch`. It does not need bash when the task is limited to documentation files.

### Release orchestrator

A release orchestrator needs `read`, `grep`, `glob`, and `task` to delegate independent code review, test, and documentation checks. Keep its task permission allowlist explicit and collect each child result before synthesizing release readiness.

## Use and validate an agent

1. Keep the prompt's scope and boundaries narrow.
2. Give it only the tools required for its work.
3. Run a representative task and inspect the result before relying on it in a workflow.
4. Keep the returned contract concise enough for the parent agent to act on.
