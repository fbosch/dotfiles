---
name: linear-issue-workflow
description: Run a Linear issue from intake to PR with explicit delivery gates. Use when the user asks to work a Linear ticket (id or URL), create or switch a WorkTrunk worktree or branch, implement requested changes, run local format or lint checks, and ship with commit, push, PR creation, plus optional Linear status update. Includes deterministic fallback behavior when commit or push is denied by runtime policy.
---

# Linear Issue Workflow

Use this skill as orchestration glue across Linear, WorkTrunk, local validation, and GitHub PR workflows.

Reuse existing `linear` and `worktrunk` skills for tool details; this skill defines execution order, decision points, and failure handling.

OpenSpec role in this workflow:
- Linear is intake, prioritization, ownership, and status.
- OpenSpec is the implementation contract when work requires spec discipline.
- Do not duplicate full OpenSpec artifacts into Linear; link to artifact paths when available.

## Reference Loading Rules

- Read `references/ship-failures.md` when any phase fails, when ship permissions are denied, or when worktree state is inconsistent.
- Read `references/pr-linear-mapping.md` when preparing PR title/body, linking PR to Linear, or updating Linear state.
- Read `references/linear-prompt-parsing.md` when the user provides a pasted Linear prompt block (for example `Work on Linear issue INF-45` plus `<issue ...>` XML).
- Use `pr-description` skill for PR body composition during PR creation; keep title format/type rules in the active PR command.
- Do not load references during intake if issue context is complete and no failure branch is active.

## Required Inputs

- Linear issue id (`ENG-123`), issue URL, or a pasted Linear issue block in prompt XML format.
- Optional shipping target (for example draft PR vs ready PR).

If no issue id exists, stop and request one.

## Workflow

Follow these phases in order.

### Phase 1: Intake and scope gate

1. Detect input source in this order:
   - Prompt-embedded issue block (`<issue identifier="..."> ... </issue>`)
   - Explicit issue id/URL
2. If prompt-embedded issue exists, parse it first and treat it as authoritative task intent.
3. If required fields are missing (for example `gitBranchName`, state, assignee), fetch `linear_get_issue` to enrich metadata.
4. Extract: identifier, title, description, priority, labels, assignee, `gitBranchName`, team, project, and current state.
5. If description is thin or ambiguous, fetch comments with `linear_list_comments`.
6. Before coding, restate all of these:
   - Problem to solve
   - Non-goals
   - Acceptance criteria
   - Unknowns or blockers

7. Detect whether the Linear issue is OpenSpec-like and classify `specSignal`:
   - `strong`: issue/comment content includes multiple OpenSpec-structured sections (for example `## Requirements`, `## Non-goals`, `## Design`, `## Tasks`), requirement keywords (`MUST`/`SHALL`), and task checklist numbering (`- [ ] 1.1 ...`).
   - `partial`: issue has some structured requirements/tasks but lacks enough completeness for direct implementation.
   - `none`: issue is standard ticket prose without OpenSpec-like structure.

8. Determine `specDecision` before implementation:
   - `required` when work implies net-new behavior, contract/config/schema changes, migrations, cross-cutting refactors, or ambiguous acceptance criteria.
   - `not_required` for narrow, low-risk, local fixes with clear acceptance criteria.
   - if classification is ambiguous, default to `required` and list ambiguity in unknowns/blockers.

9. If `specSignal` is `strong` or `partial`, attempt OpenSpec context detection in repo (read-only):
   - `openspec list --json`
   - if change candidate exists, `openspec status --change "<name>" --json`

10. Routing rules:
   - `specDecision=not_required`: continue standard implementation flow.
   - `specDecision=required` and matching OpenSpec change exists: treat OpenSpec artifacts as source of truth and continue.
   - `specDecision=required` and no matching OpenSpec change exists: stop before coding and return precise next action to create/approve the change.

If acceptance criteria are still unclear after comments, stop and ask for clarification before implementation.

### Phase 2: Branch and worktree decision

Branch naming precedence:

1. Use `gitBranchName` from Linear as the primary branch name whenever it is present.
2. Only build `feature/<issue-id>-<slug>` when `gitBranchName` is missing.
3. Enforce issue-id inclusion for every branch used with WorkTrunk. If the candidate branch does not contain the lowercase issue id token (for example `inf-45`), prefix it as `<issue-id>/...` or `feature/<issue-id>-...`.
4. Slug rules: lowercase kebab-case from title, only `[a-z0-9-]`, repeated `-` collapsed, and slug length around 48 chars.

Worktree rules:

1. Always use WorkTrunk for task execution. Do not run implementation work directly on the current checkout without switching/creating the issue branch worktree first.
2. Resolve the target branch from Linear metadata first (`gitBranchName` when available).
3. If branch has no worktree, call `worktrunk-create` with that branch.
4. If worktree already exists, call `worktrunk-switch` to that branch.
5. If branch name fails validation, sanitize while preserving issue-id inclusion and report the exact transformation before proceeding.
6. If issue title is empty and `gitBranchName` is missing, use `feature/<issue-id>-work-item`.

### Phase 3: Implementation loop

1. Implement only what is required by acceptance criteria.
2. If an OpenSpec change is present, implement against `tasks.md` plus `proposal/spec/design` context; do not treat Linear prose as canonical.
3. Keep changes narrow and avoid drive-by refactors.
4. After each meaningful edit, re-check criteria and stop when all are true:
   - Every acceptance criterion maps to a concrete code change or explicit no-change note.
   - No unresolved blocker remains.
   - Current diff is validation-ready.

### Phase 4: Local validation

Run smallest relevant checks first, then expand only if needed.

Command selection order:

1. If `package.json` exists: `format` script, then `lint`, then targeted tests.
2. If non-JS project: run the repo-standard formatter/lint/test equivalents.
3. If no scripted checks exist: perform explicit manual review (`git status`, `git diff`, key-file inspection) and state that automated checks were unavailable.

If validation fails, fix and rerun only failed checks before shipping.

### Phase 5: Ship decision matrix

Use this matrix; do not improvise shipping outcomes.

OpenSpec task sync rule (when applicable):

1. If this issue is linked to an OpenSpec change and `<change>/tasks.md` exists, update that checklist before ship completion.
2. Tick only tasks that were actually completed in this delivery.
3. Leave incomplete or deferred tasks unchecked; do not infer completion from intent alone.
4. If task mapping is ambiguous, stop and report the ambiguity instead of mass-checking items.

1. `commit:allowed` + `push:allowed`
    - Prepare commit tied to issue id.
    - Push branch.
    - Compose PR body using `pr-description` skill policy (title remains command-owned).
    - Open PR and return URL.
2. `commit:denied` + `push:denied`
    - Stop at ship gate.
    - Provide exact blocked steps and exact user-runnable commands.
    - Still provide PR title/body draft; draft body should follow `pr-description` skill policy.
3. `commit:allowed` + `push:denied`
   - Create commit.
   - Report push as blocked and provide next command.
   - Do not claim PR opened.
4. `commit:denied` + `push:allowed`
   - Treat as blocked (cannot ship without commit).
   - Provide exact next step.

When PR is created, optionally update Linear issue with PR URL and move to review state.

Before opening PR, check for an existing PR on the same branch. If one exists, return that URL and avoid duplicate PR creation.

## Failure Handling

For each failed phase, report: `phase`, `failure`, `impact`, `next action`.

Common failure branches:

- Linear issue not found or inaccessible -> confirm identifier/workspace access and stop.
- Linear URL malformed -> extract identifier or ask for explicit id.
- `specDecision=required` but OpenSpec change missing -> stop before coding and return exact create/approve next step.
- Worktree create conflict -> switch to existing worktree or choose a sanitized alternate branch.
- Detached HEAD or unexpected branch -> switch to intended branch before validation/shipping.
- Validation command missing -> fallback to available checks and report gap.
- PR creation API failure -> provide ready-to-run PR metadata and recovery step.
- OpenSpec tasks file missing for a matched change -> continue shipping, but report that task sync was skipped.
- OpenSpec task mapping unclear -> report exact ambiguous items and request clarification before checking boxes.

## NEVER

- NEVER start coding before restating acceptance criteria; this prevents scope drift.
- NEVER start coding when `specDecision=required` and no approved OpenSpec change is available.
- NEVER claim shipping is complete without a PR URL.
- NEVER hide permission-denied steps; show exact blocked command and next action.
- NEVER run heavyweight full-suite checks when a targeted check is enough.
- NEVER open a second PR for the same branch when one already exists.
- NEVER use ad-hoc branch names when Linear provides `gitBranchName`, unless sanitization is required.
- NEVER bypass WorkTrunk for branch/worktree setup in this workflow.

## Output Contract

Always return these six blocks:

1. Issue summary (problem, non-goals, acceptance criteria)
2. Spec status (`specSignal`, `specDecision`, canonical source, OpenSpec change match/mismatch)
3. Branch/worktree outcome (name, create vs switch, sanitization if applied)
4. Change summary (files and intent)
5. Validation results (what ran, pass/fail, skipped with reason)
6. Shipping status (committed/pushed/PR URL or blocked with exact next step)

When OpenSpec applies, include task-sync status in block 6 (`updated`, `skipped`, or `blocked`) with path and reason.
