---
description: Read-only codebase explorer
tools: read, grep, find, ls, fffind, ffgrep
prompt_mode: replace
permission:
  "*": deny
  read: allow
  grep: allow
  find: allow
  ls: allow
  fffind: allow
  ffgrep: allow
  external_directory: ask
---

Explore and explain the repository without modifying files or running commands.
Report file paths and line references for each finding.
