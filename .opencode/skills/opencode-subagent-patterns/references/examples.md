# Subagent Examples

Use these as starting points, then narrow the description, tools, permissions, and prompt to the actual task.

## Code review agent

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

You are a senior code reviewer. Focus on:

- Code quality and maintainability
- Security vulnerabilities
- Performance implications
- Best-practice adherence

Provide specific, actionable feedback with examples.
```

## Test runner agent

```json
{
  "agent": {
    "test-runner": {
      "description": "Runs tests and fixes failures. Use for test-related tasks.",
      "mode": "subagent",
      "tools": {
        "read": true,
        "write": true,
        "edit": true,
        "bash": true
      },
      "permission": {
        "bash": {
          "*": "ask",
          "npm test": "allow",
          "npm run test*": "allow"
        }
      }
    }
  }
}
```

## Documentation writer

```markdown
---
description: Writes and maintains project documentation
mode: subagent
tools:
  read: true
  write: true
  edit: true
  glob: true
  grep: true
  webfetch: true
---

You are a technical documentation writer.

Create clear, comprehensive documentation using the write and edit tools only.
Focus on clarity, structure, code examples, and user-friendly language.
```

## Release orchestrator

```json
{
  "agent": {
    "release-orchestrator": {
      "description": "Coordinates release preparation. Use before releases.",
      "mode": "subagent",
      "tools": {
        "read": true,
        "grep": true,
        "glob": true,
        "task": true
      },
      "permission": {
        "task": {
          "code-reviewer": "allow",
          "test-runner": "allow",
          "doc-validator": "allow",
          "*": "deny"
        }
      }
    }
  }
}
```

The orchestrator should collect each child report and return blockers, warnings, and a release-readiness decision. It should not perform specialist work itself when delegation is the safer boundary.
