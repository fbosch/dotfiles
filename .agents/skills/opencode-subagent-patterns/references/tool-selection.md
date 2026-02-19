# Tool Selection and Permissions

Guide for selecting appropriate tools for subagents and managing permissions to avoid approval spam and ensure clean workflows.

## Available Tools in OpenCode

Core tools that can be assigned to agents:

| Tool | Purpose | Type |
|------|---------|------|
| **read** | Read files (text, images, PDFs, notebooks) | Read-only |
| **write** | Create or overwrite files | Write |
| **edit** | Exact string replacements in files | Write |
| **glob** | File pattern matching (`**/*.ts`) | Read-only |
| **grep** | Content search with regex | Read-only |
| **bash** | Execute shell commands | Execute |
| **task** | Spawn subagents | Orchestration |
| **webfetch** | Fetch and analyze web content | Web |
| **todowrite** | Create/manage task lists | Organization |
| **todoread** | Read current task list | Organization |
| **skill** | Execute skills | Skills |

## Tool Access Principle

**If an agent doesn't need a tool, don't give it that tool.**

Each unnecessary tool increases complexity and potential for approval spam.

### Recommended Tool Sets by Agent Type

| Agent Type | Recommended Tools | Notes |
|------------|-------------------|-------|
| **Read-only reviewers** | `read, grep, glob` | No write capability |
| **File creators** | `read, write, edit, glob, grep` | ⚠️ **No bash** - avoids approval spam |
| **Script runners** | `read, write, edit, glob, grep, bash` | Use when CLI execution needed |
| **Research agents** | `read, grep, glob, webfetch` | Read-only + external access |
| **Documentation** | `read, write, edit, glob, grep, webfetch` | No bash for cleaner workflow |
| **Orchestrators** | `read, grep, glob, task` | Minimal tools, delegates to specialists |
| **Full access** | Omit `tools` field (inherits all) | Use sparingly |

## Avoiding Bash Approval Spam

### The Problem

When subagents have `bash` in their tools list, they often default to using bash commands for file operations:

```bash
cat > file.txt << 'EOF'
content here
EOF
```

Each unique bash command requires user approval, causing:
- Dozens of approval prompts per agent run
- Slow, frustrating workflow
- Hard to review (heredocs are walls of content)

### Root Causes

1. **Models default to bash for file ops** - Training data bias toward shell commands
2. **Bash in tools list = Bash gets used** - Even if write tool is available
3. **Instructions get buried** - A "don't use bash" rule at line 300 of a 450-line prompt gets ignored

### Solutions

**1. Remove bash from tools list** (if not needed):

```json
{
  "agent": {
    "site-builder": {
      "tools": {
        "read": true,
        "write": true,
        "edit": true,
        "glob": true,
        "grep": true
      }
    }
  }
}
```

If the agent only creates files, it doesn't need bash. The primary agent can run necessary scripts after.

**2. Put critical instructions FIRST** (immediately after frontmatter):

```markdown
---
description: Builds static sites from templates
mode: subagent
tools:
  read: true
  write: true
  edit: true
  glob: true
  grep: true
---

## ⛔ CRITICAL: USE WRITE TOOL FOR ALL FILES

**You do NOT have bash access.** Create ALL files using the **write tool**.

---

[rest of prompt...]
```

Instructions at the top get followed. Instructions buried 300 lines deep get ignored.

**3. Remove contradictory instructions**:

```markdown
# BAD - contradictory
Line 75: "Copy images with `cp -r intake/images/* build/images/`"
Line 300: "NEVER use cp, mkdir, cat, or echo"

# GOOD - consistent
Only mention the pattern you want used. Remove all bash examples if you want write tool.
```

### When to Keep Bash

Keep bash when the agent needs to:
- Run external CLIs (npm, git, curl, wrangler)
- Execute project-specific scripts
- Check command outputs (git status, npm test)

## Permission Modes

Control what actions an agent can take with permission settings:

```json
{
  "agent": {
    "plan": {
      "permission": {
        "edit": "ask",
        "bash": "ask",
        "webfetch": "deny"
      }
    }
  }
}
```

### Permission Levels

- `"ask"` — Prompt for approval before running the tool
- `"allow"` — Allow all operations without approval
- `"deny"` — Disable the tool entirely

### Bash Command Permissions

You can set permissions for specific bash commands:

```json
{
  "agent": {
    "build": {
      "permission": {
        "bash": {
          "*": "ask",
          "git status": "allow",
          "git log*": "allow",
          "grep *": "allow",
          "git push": "ask"
        }
      }
    }
  }
}
```

**Rule precedence**: Last matching rule wins. Put `*` wildcard first, then specific rules:

```json
{
  "bash": {
    "*": "ask",           // Default: ask for all
    "git status*": "allow",  // Override: allow git status
    "git push*": "deny"      // Override: deny git push
  }
}
```

## Task Tool Permissions

Control which subagents an agent can invoke via the task tool:

```json
{
  "agent": {
    "orchestrator": {
      "permission": {
        "task": {
          "*": "deny",
          "orchestrator-*": "allow",
          "code-reviewer": "ask"
        }
      }
    }
  }
}
```

When set to `"deny"`, the subagent is removed from the task tool description entirely, so the model won't attempt to invoke it.

**Tip**: Users can always invoke any subagent directly via `@` mention, even if task permissions would deny it.

## Configuration Examples

### Read-Only Code Reviewer

```json
{
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for quality, security, and best practices",
      "mode": "subagent",
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

### Documentation Writer (No Bash)

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

Create clear, comprehensive documentation using the **write** and **edit** tools only.
```

### Script Runner (Needs Bash)

```json
{
  "agent": {
    "test-runner": {
      "description": "Runs tests and fixes failures",
      "mode": "subagent",
      "tools": {
        "read": true,
        "write": true,
        "edit": true,
        "glob": true,
        "grep": true,
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

### Orchestrator (Minimal Tools)

```json
{
  "agent": {
    "release-orchestrator": {
      "description": "Coordinates release preparation across multiple specialists",
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

## Best Practices

1. **Start minimal** - Give agents only essential tools, add more if needed
2. **No bash for file creators** - Use write/edit tools to avoid approval spam
3. **Put tool instructions first** - Critical usage rules go at the top of prompts
4. **Be consistent** - Don't show bash examples if you want write tool usage
5. **Test before deploying** - Run agent with sample tasks to verify tool usage patterns
6. **Use task permissions** - Prevent unintended orchestration with task tool allowlists
7. **Allow safe read commands** - `git status`, `git log`, basic greps can be allowed without risk
