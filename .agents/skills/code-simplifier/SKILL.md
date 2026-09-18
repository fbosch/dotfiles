---
name: code-simplifier
description: Simplify and refine code for clarity, consistency, and maintainability while preserving exact behavior. Use to clean up recently written or modified code, reduce nesting and redundant abstractions, apply project coding standards, or improve readability without changing what the code does.
---

# Code Simplifier

## Scope and Constraints

- Default to code changed in the current session; use the diff and session history to identify it without sweeping in unrelated worktree changes. Expand the scope only when requested.
- Preserve outputs, errors, side effects, and their ordering. Do not remove security checks, authorization, validation, or observability. Note behavior-changing opportunities separately instead of implementing them.
- Favor clarity over fewer lines. If a rewrite offers no clear benefit, leave the code unchanged.
- Do not introduce dependencies or architecture merely to remove minor duplication.

## Cleanup Candidates

- For control-flow or async rewrites, compare branch outcomes and observable event order, including work initiation, awaits, errors, cancellation, and cleanup. Equal final values alone do not establish equivalent behavior.
- Replace deeply nested ternaries with control flow that makes the alternatives easier to follow.
- Remove redundant code. Remove indirection only when it hides no meaningful policy, invariant, or lifecycle responsibility; size and usage count alone do not establish redundancy.
- Extract duplicated logic only when the call sites share a responsibility and should change together. Similar code serving independent policies should remain separate.
- Delete comments that merely restate the code; retain explanations of constraints and intent.

## Verification and Reporting

Trace the affected outputs, error paths, and side-effect ordering, then run the relevant existing tests and the smallest additional check needed for the changed paths. Passing tests alone do not prove equivalence; report unverified paths or assumptions.

Summarize changes that affect understanding and the validation performed. If no change is warranted, say so rather than manufacturing a cleanup.
