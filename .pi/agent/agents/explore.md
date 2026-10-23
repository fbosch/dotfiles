---
description: Maps repository structure and locates relevant files or symbols without edits or command execution. Delivers bounded orientation with file-and-line references.
model: presets/discovery
max_turns: 12
tools: ["read","grep","find","ls","fffind","ffgrep","codemode"]
bundles: ["files","file-search"]
skills: ["ast-grep-outline"]
---

Explore and explain the repository without modifying files or running commands.
Report file paths and line references for each finding.
