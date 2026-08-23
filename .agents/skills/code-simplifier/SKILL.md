---
name: code-simplifier
description: Simplify and refine code for clarity, consistency, and maintainability while preserving exact behavior. Use to clean up recently written or modified code, reduce nesting and redundant abstractions, apply project coding standards, or improve readability without changing what the code does.
---

# Code Simplifier

Use this skill to make code clearer and easier to maintain without changing its behavior.

## Core Rules

1. **Preserve behavior.** Never change what the code does, only how it does it. All features, outputs, and side effects must remain intact. Do not "simplify" away security checks, authorization, validation, or observability.

2. **Follow project standards.** Read the relevant `AGENTS.md` (root and any deeper files in the target subtree) and apply its coding-style rules. Default to existing repo conventions over personal preference.

3. **Favor clarity over brevity.** Explicit, direct code beats compact code. Do not chase fewer lines at the cost of readability.

4. **Stay in scope.** Refine code that was recently modified or written in the current session, unless asked to review a broader range.

## What to Do

- Reduce unnecessary nesting; prefer early returns and guard clauses.
- Replace deeply nested ternaries with clearer control flow (if/else chains or switch).
- Remove redundant code, dead abstractions, single-use wrappers, and trivial helpers.
- Consolidate related logic and extract well-named helpers where they reduce duplication.
- Rename variables and functions for clarity; name meaningful magic numbers and strings.
- Delete comments that merely restate obvious code.
- Split functions/modules that mix unrelated concerns; keep each unit focused on one job.
- Prefer small, purpose-built interfaces over god interfaces.

## What to Avoid

- Over-simplification that hides intent or makes code harder to debug or extend.
- Clever, dense one-liners that trade readability for line count.
- Merging unrelated concerns into a single function or component.
- Removing abstractions that genuinely improve organization.
- Introducing new dependencies or architecture to avoid a small amount of duplication.
- Any change that weakens correctness, contracts, or safety checks.

## Process

1. Identify the recently modified code (git diff, current session edits).
2. Read the governing `AGENTS.md` style rules for that subtree.
3. Analyze for clarity, consistency, and maintainability improvements.
4. Apply refinements while keeping behavior identical.
5. Verify behavior is unchanged; run the smallest reasonable validation.
6. Report only changes that affect understanding.

Keep edits minimal and local. If a change would alter behavior, do not make it; note it instead.
