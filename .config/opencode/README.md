# OpenCode Configuration

Custom AI development setup with specialized agents, commands, and skills.

## Structure

- `opencode.json` - Main config (models, MCP servers, theme)
- `AGENTS.md` - Behavior rules and preferences
- `agents/` - Specialized agents (benchmark, debug, docs, quick, refactor, research, review, test)
- `commands/` - Workflow commands (commit-msg, gh-pr-feedback, pr-desc, resolve-conflicts, rmslop)
- `skills/` - Reusable knowledge modules (symlinked from `.agents/skills/`)
- `themes/` - Color schemes (zenwritten-dark)

## Models

- Primary: `openai/gpt-5.3-codex`
- Small: `github-copilot/claude-haiku-4.5`

## MCP Servers

- `context7` - Library documentation
- `exa` - Web search
- `sequential-thinking` - Complex reasoning
- `github` - GitHub API integration

## Usage

Agents: `@debug "issue description"` or `@refactor "target code"`
Commands: `/commit-msg`, `/pr-desc`, `/rmslop`
