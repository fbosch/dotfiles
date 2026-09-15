---
description: Ported from evaluate-skill.eval.yaml task "Explains independent skill and judge engines are selected at run time"
tags: [spec-authoring]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Create an evaluation spec file at `mixed-backend.eval.yaml` that evaluates a Claude Code skill at `~/.claude/skills/review/SKILL.md` but is judged by Codex. Include one task named "Reviews staged changes", prompt "Review the staged changes", and expectation "The review reports at least one actionable issue." Then tell me the exact command to run it that way.
