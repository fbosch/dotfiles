# Test-Pruning Report Template

Use for multi-file audits or proposed deletions. Include every inventoried file in the ledger, with case-level notes for differing decisions. Mark files awaiting review `pending`, not `retained`; use `blocked` only for an actual impediment. Record recommendations under proposed action and reserve applied change for edits actually made.

```markdown
## Test-Quality Audit

Scope: [repository/paths, definition of unit tests, inventory method]
Excluded or unfinished: [paths and reasons, or none]
Baseline: [command, result, pre-existing failures]

## Audit ledger

| Unit-test file | Disposition | Proposed action (if any) | Applied change (if any) | Rationale and case-level exceptions | Verification |
|---|---|---|---|---|---|
| path/to/test.ext | pending/retained/improved/removed/blocked | KEEP/REWRITE/CONSOLIDATE/MOVE LEVEL/DELETE/QUARANTINE or none | What changed, or none | Protected behavior, independent evidence, or blocker; note skipped cases | Command/result, baseline reused, or not run |

## Changes

- Proposed improvements or removals (audit-only): [test cases, rationale, protection to preserve; write none if not applicable]
- Applied improvements and credible gaps filled: [representative examples or none]
- Applied removals: [test cases, independent evidence, and where unique protection remains; or none]
- Suspected production bugs or unresolved requirements: [evidence and next decision]

## Validation

- Focused batch checks: [commands/results]
- Repository-required checks: [commands/results]
- Intended-defect checks for substantial rewrites: [temporary mutation or equivalent result; confirm restoration]
- Pre-existing versus introduced failures: [details]
- Not run: [commands/reasons]

## Remaining scope and risk

- [Unreviewed files, blocked decisions, and validation gaps; say none only when verified]
```

Counts of files and actions may help track progress; they do not prove the tests improved.
