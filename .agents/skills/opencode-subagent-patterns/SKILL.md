---
name: opencode-subagent-patterns
description: Design and implement effective subagent patterns in OpenCode. Use when creating custom agents, orchestrating multi-agent workflows, delegating batch processing tasks, optimizing tool permissions to avoid approval spam, selecting appropriate models for agents, or implementing any multi-agent coordination pattern. Covers agent creation, orchestration, delegation strategies, tool selection, permission management, and prompt templates.
---

# OpenCode Subagent Patterns

## Overview

Sub-agents are specialized AI assistants that primary agents can delegate tasks to. Each sub-agent has its own context window, configurable tools, and custom system prompt. This skill provides patterns and best practices for creating effective sub-agent workflows in OpenCode.

## Why Use Subagents: Context Hygiene

The primary value of subagents isn't just specialization—it's **keeping your main context clean**.

**Without subagent** (context bloat):

```text
Main context accumulates:
├─ git status output (50 lines)
├─ npm run build output (200 lines)
├─ test results (100 lines)
├─ deployment logs (100 lines)
└─ Context: 📈 450+ lines consumed
```

**With subagent** (context hygiene):

```text
Main context:
├─ "Deploy to production"
├─ [agent summary - 30 lines]
└─ Context: 📊 ~50 lines consumed

Subagent context (isolated):
├─ All verbose tool outputs
├─ All intermediate reasoning
└─ Discarded after returning summary
```

**The math**: A deploy workflow runs ~10 tool calls. That's 450+ lines in main context vs 30-line summary with a subagent. Over a session, this compounds dramatically.

**When this matters most**:
- Repeatable workflows (deploy, migrate, audit, review)
- Verbose tool outputs (build logs, test results, API responses)
- Multi-step operations where only the final result matters
- Long sessions where context pressure builds up

## Built-in Subagents

OpenCode includes built-in subagents available out of the box:

### General Agent

General-purpose agent for complex, multi-step tasks requiring both exploration AND action.

- **Mode**: Subagent
- **Capabilities**: Read AND write
- **Tools**: All tools except todo
- **When to use**: Complex research, multi-step operations, code modifications

### Explore Agent

Fast, lightweight agent optimized for **read-only** codebase exploration.

- **Mode**: Subagent
- **Capabilities**: Strictly read-only
- **Tools**: Glob, Grep, Read, Bash (read-only commands)
- **When to use**: Searching/understanding codebase without making changes

You can also invoke these by **@ mentioning** them: `@general` or `@explore`

## Creating Custom Subagents

### Agent Locations

| Type | Location | Scope | Priority |
|------|----------|-------|----------|
| Project | `.opencode/agents/` | Current project only | Highest |
| User | `~/.config/opencode/agents/` | All projects | Lower |

When names conflict, project-level takes precedence.

### Configuration Methods

**Method 1: Interactive Creation**

```bash
opencode agent create
```

This interactive command will:
1. Ask where to save the agent (global or project)
2. Request description of what the agent should do
3. Generate appropriate system prompt and identifier
4. Let you select which tools the agent can access
5. Create a markdown file with the configuration

**Method 2: JSON Configuration**

Configure agents in your `opencode.json` config file:

```json
{
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for best practices and potential issues. Use after code changes.",
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

**Method 3: Markdown Files**

Place markdown files in `.opencode/agents/` or `~/.config/opencode/agents/`:

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

You are in code review mode. Focus on:
- Code quality and best practices
- Potential bugs and edge cases
- Performance implications
- Security considerations

Provide constructive feedback without making direct changes.
```

The markdown file name becomes the agent name. For example, `review.md` creates a `review` agent.

## Core Configuration Fields

### Required Fields

- **description**: What the agent does and when to use it. Include "use PROACTIVELY" or "MUST BE USED" for automatic invocation.
- **mode**: Set to `"subagent"` for sub-agents, `"primary"` for primary agents, or `"all"` for both.

### Optional Fields

- **model**: Override model for this agent (e.g., `"anthropic/claude-sonnet-4-20250514"`). If omitted, inherits from primary agent.
- **temperature**: Control randomness (0.0-1.0). Lower = focused, higher = creative. Default varies by model.
- **tools**: Object specifying which tools are enabled (`true`/`false`). Omit to inherit all tools.
- **permission**: Control tool permissions (`"ask"`, `"allow"`, `"deny"`). Applies to `edit`, `bash`, `webfetch`, and `task` tools.
- **prompt**: Custom system prompt file path (relative to config location)
- **hidden**: Set to `true` to hide from `@` autocomplete (subagent only)
- **color**: UI color (hex like `"#FF5733"` or theme color like `"accent"`)
- **steps**: Maximum agentic iterations before forced text-only response

### Example with All Options

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

## Using Subagents

### Automatic Delegation

Primary agents proactively delegate based on:
- Task description in your request
- `description` field in subagent config
- Current context and available tools

**Tip**: Include "use PROACTIVELY" or "MUST BE USED" in description for more automatic invocation.

### Explicit Invocation

Use `@` mention to explicitly invoke a specific subagent:

```text
> @code-reviewer look at my recent changes
> @test-runner fix the failing tests
> @explore find where user authentication is handled
```

### Session Navigation

When subagents create child sessions, navigate between parent and children:

- **<Leader>+Right** (or `session_child_cycle`) - Cycle forward through sessions
- **<Leader>+Left** (or `session_child_cycle_reverse`) - Cycle backward through sessions

## Advanced Patterns

For detailed guidance on specific patterns, see the reference files:

### Orchestration

**See [references/orchestration.md](references/orchestration.md)**

How to create orchestrator agents that delegate to multiple specialists:
- Enabling orchestration with the `task` tool
- Orchestrator pattern examples
- Multi-specialist workflows
- Parallel research patterns
- Nesting depth considerations
- Task permission control

### Delegation

**See [references/delegation.md](references/delegation.md)**

Best practices for delegating tasks to subagents:
- The sweet spot: repetitive tasks requiring judgment
- Core prompt template (5-step structure)
- Batch sizing guidelines
- Complete workflow pattern
- Commit strategies
- Error handling
- Context considerations
- Persona-based routing

### Prompt Templates

**See [references/prompt-templates.md](references/prompt-templates.md)**

Proven templates for common patterns:
- Audit/Validation pattern
- Bulk Update pattern
- Research/Comparison pattern
- Migration pattern
- Template customization guidelines
- Authority vs reporting
- Output format consistency

### Tool Selection

**See [references/tool-selection.md](references/tool-selection.md)**

Choosing appropriate tools and managing permissions:
- Available tools in OpenCode
- Tool access principle
- Recommended tool sets by agent type
- Avoiding bash approval spam
- Permission modes and levels
- Bash command permissions
- Task tool permissions
- Configuration examples

### Model Selection

**See [references/model-selection.md](references/model-selection.md)**

Choosing appropriate models for different agent types:
- Quality-first approach
- Model selection by task type
- Configuration examples
- Temperature settings
- Reasoning model parameters
- Context window considerations
- Cost optimization strategies
- Best practices

## Quick Reference

```text
Built-in subagents:
  @general  → Full tools, read/write
  @explore  → Read-only, fast exploration

Create agents:
  opencode agent create (interactive)
  .opencode/agents/*.md (markdown)
  opencode.json agent.{name} (JSON)

Config fields:
  description (required) - What and when to use
  mode (required) - "subagent", "primary", or "all"
  model, temperature, tools, permission (optional)

Tool access principle:
  ⚠️ Don't give bash unless agent needs CLI execution
  File creators: read, write, edit, glob, grep (no bash!)
  Script runners: read, write, edit, glob, grep, bash (only if needed)

Model selection (quality-first):
  Default: Standard tier (Sonnet/GPT-4)
  Creative: Premium tier (Opus/GPT-5)
  Scripts only: Fast tier (Haiku/Flash/Mini)
  ⚠️ Avoid fast tier for content - quality drops significantly

Delegation:
  Batch size: 5-8 items per agent
  Parallel: 2-4 agents simultaneously
  Prompt: 5-step (read → verify → check → evaluate → FIX)

Orchestration:
  Enable: Add "task" to agent's tools
  Depth: Keep to 2 levels max
  Use: Multi-phase workflows, parallel specialists
```

## Common Use Cases

### Code Review Agent

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
- Best practices adherence

Provide specific, actionable feedback with examples.
```

### Test Runner Agent

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

### Documentation Writer

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

### Release Orchestrator

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

## Best Practices

1. **Start minimal**: Give agents only essential tools, add more if needed
2. **No bash for file creators**: Use write/edit tools to avoid approval spam
3. **Put tool instructions first**: Critical usage rules go at top of prompts
4. **Be consistent**: Don't show bash examples if you want write tool usage
5. **Default to standard tier models**: Quality matters more than cost savings
6. **Include "use PROACTIVELY" in descriptions**: For automatic invocation
7. **Test before deploying**: Run agent with sample tasks to verify behavior
8. **Use task permissions**: Prevent unintended orchestration with allowlists
9. **Keep orchestration shallow**: 2 levels max for agent nesting
10. **Agents don't commit**: Review changes before committing

## Performance Considerations

| Consideration | Impact |
|---------------|--------|
| **Context efficiency** | Subagents preserve main context, enabling longer sessions |
| **Latency** | Subagents start fresh, may add latency gathering context |
| **Thoroughness** | Explore agent's speed vs completeness tradeoff |
| **Deep operations** | Agents with 90+ tool calls work fine for meaningful work |
