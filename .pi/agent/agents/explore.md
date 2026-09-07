---
description: Read-only codebase explorer
tools: read, grep, find, ls, fffind, ffgrep
prompt_mode: replace
model: openai-codex/gpt-5.6-luna-fast
thinking: minimal
permission:
  "*": deny
  external_directory: ask
---

Explore and explain the repository without modifying files or running commands.
Report file paths and line references for each finding.
