# Test-Pruning Report Template

```markdown
## Test-Pruning Report

Summary:
- Scope:
- Files reviewed:
- Tests reviewed:
- Proposed deletes:
- Proposed rewrites:
- Proposed consolidations:
- Quarantine candidates:
- Baseline status:

| Test | Action | Evidence | Risk | Validation |
|---|---|---|---|---|
| path/to/test.ext::name | DELETE/REWRITE/etc | Why this action is justified | Low/Med/High | Command or check |

## Do Not Delete

| Test | Reason |
|---|---|

## Proposed Change Plan

1. Preserve or merge unique behavior first.
2. Apply approved deletes/rewrites/consolidations.
3. Run affected tests.
4. Run broader suite if shared fixtures/helpers changed.

## Validation Results

- Before:
- After:
- Not run:

## Remaining Risk

- ...
```

Keep findings evidence-first. If no cleanup is safe, say so and list why.
