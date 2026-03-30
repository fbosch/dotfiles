---
description: Find my next Linear issue and run the full issue workflow
agent: build
---

@.agents/skills/linear-issue-workflow/SKILL.md

User override input: `$ARGUMENTS`

Goal: Remove manual copy/paste from Linear UI. If no explicit issue is provided, pick the next best actionable issue assigned to me, then execute the full linear-issue-workflow on it.

Selection rules:

1. If `$ARGUMENTS` is non-empty, treat it as authoritative issue input (ID like `ENG-123`, URL, or pasted issue block) and run the workflow directly.
2. If `$ARGUMENTS` is empty:
   - Call `linear_list_issues` with `assignee: "me"`, `includeArchived: false`, and a broad enough limit to rank candidates.
   - Exclude issues in terminal states (done/completed/canceled).
   - Prefer higher priority first (Urgent -> High -> Normal -> Low), then earliest due date, then oldest updated item.
   - If no actionable issue remains, stop and report that no candidate issue was found.
3. Once a candidate is chosen, treat its identifier as the workflow input and execute the complete process from the Linear Issue Workflow skill.

Output contract:

- Start with `Selected issue: <IDENTIFIER> - <TITLE>`.
- Then return the same five blocks required by the Linear Issue Workflow skill.
