---
description: Implement tasks from an OpenSpec change
argument-hint: "[change name]"
agent: general
inherit_context: true
---

Follow the canonical `openspec-apply-change` skill at `.agents/skills/openspec-apply-change/SKILL.md` for this request. Read it fully before acting.

This is a thin Pi wrapper: do not duplicate or modify the skill's workflow. Map its host-tool references to Pi tools: `AskUserQuestion` to `ask_user_question`, `TodoWrite` to `todo`, and `Task` to `subagent`.

User input:
$ARGUMENTS
