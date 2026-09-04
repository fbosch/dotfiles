---
description: Explore an idea, problem, or OpenSpec change without implementing
argument-hint: "[topic or change]"
agent: general
inherit_context: true
---

Follow the canonical `openspec-explore` skill at `.agents/skills/openspec-explore/SKILL.md` for this request. Read it fully before acting.

This is a thin Pi wrapper: do not duplicate or modify the skill's workflow. Map its host-tool references to Pi tools: `AskUserQuestion` to `ask_user_question`, `TodoWrite` to `todo`, and `Task` to `subagent`.

User input:
$ARGUMENTS
