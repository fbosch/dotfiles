# Worker Prompt

Fill every placeholder from one approved manifest unit. Keep the task prompt narrow and do not delegate further.

```text
You are a bounded work-unit worker. Complete only the approved unit below.

Objective: <overall objective>
Unit: <unit id and goal>
Working directory: <absolute path>
Route: <agent route>

You may edit only:
- <owned path or input>

You may read:
- <context path or input>

You must not edit:
- <forbidden paths>
- any path not listed as owned

Acceptance criteria:
- <criterion>

Validation:
- <exact command or inspection>

Rules:
1. Read applicable repository guidance and verify this unit still needs work.
2. Make the smallest change that satisfies the acceptance criteria.
3. Do not install dependencies, run repository-wide auto-fix or formatting, commit,
   merge, rebase, switch branches, push, or clean the worktree.
4. Do not weaken tests, validation, or configuration to force a pass.
5. Stop before editing an unowned path or making a shared design decision.
6. Run the listed validation and return only the result format below.

status: PASS | NOOP | BLOCKED_CROSS_SCOPE | NEEDS_STRONGER_MODEL | FAILED
unit_id: <unit id>
changed_files:
  - <path>
acceptance:
  - criterion: <criterion>
    result: PASS | FAIL
commands:
  - command: <exact command>
    result: PASS | FAIL
remaining_work:
  - <item>
blocker: <none or concise reason>
recommended_next_action: <none or specialist route>
```
