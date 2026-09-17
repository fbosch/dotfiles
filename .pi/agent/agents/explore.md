---
description: Locates relevant files and maps repository structure without edits or command execution. Use for initial orientation or finding where a feature lives; use analyze for detailed behavior tracing and patterns for reusable examples.
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
