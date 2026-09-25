# Test-Pruning Rubric

## Action Taxonomy

| Action | Use when | Preferred next step |
|---|---|---|
| `KEEP` | Test protects current behavior, public contract, bug regression, or high-risk edge case | Leave untouched; note why if it looked suspect |
| `REWRITE` | Intent is valuable but assertion, mock use, setup, or coupling is weak | Preserve scenario; verify observable behavior through real code |
| `CONSOLIDATE` | Scenario overlaps stronger tests but has unique input or edge case | Merge unique data, then remove duplicate |
| `MOVE LEVEL` | Unit test is actually integration/contract behavior, or broad test should move lower | Replace at better level before removal |
| `DELETE` | No unique signal, no current behavior, mock-only theater, obsolete snapshot, or generated artifact | Delete only after the main skill's evidence gate and authorization rule |
| `QUARANTINE` | Flaky but potentially valuable and not immediately fixable | Add owner, issue/TODO, expiry, and fix/delete plan |

## Boundary Decisions

- A test duplicates a happy-path scenario but uniquely covers an invalid-input case: `CONSOLIDATE` the case into the stronger test before removing the duplicate. “Same assertion” and “same input class” are correlated observations, not two independent reasons to delete.
- A mocked collaborator is called exactly once: `KEEP` when once-only delivery is the requirement and the real SUT runs; `REWRITE` when the test only restates a mock's configured return value. The presence of a mock alone proves neither.
- A weak truthiness test is the only check on a public mapping: `REWRITE` with an independently specified key/value expectation rather than `DELETE`.

## Severity

| Severity | Meaning | Examples |
|---|---|---|
| P0 | False confidence | Mocked SUT, assertion-free test, unconditional skip, wrong result not detected by an in-contract production mutation |
| P1 | Important but weak | Over-mocked dependency chain, implementation-coupled assertions, missing negative path |
| P2 | Maintenance drag | Duplicate setup, giant snapshots, mystery fixtures, slow avoidable setup |
| P3 | Cleanup polish | Redundant descriptions, style drift, minor naming/readability |

## Deep Evidence

Use tool-backed checks when available and worth the cost:

- Mutation testing: survived mutants suggest weak or missing assertions.
- Statement removal: a removed SUT or setup call while assertions remain can suggest redundant setup; inspect what was actually exercised. Deleting an assertion from a passing test normally leaves it passing and proves nothing about its value.
- Assertion-density scans: zero assertions, log-only checks, empty catches, blank identifier assignments.
- Flake history: repeated retries, quarantine history, nondeterministic failures.
- For substantial rewrites, test an intended defect with a temporary in-contract production mutation. A surviving mutant may be equivalent or outside the requirement; investigate before calling the assertion ineffective.
Treat tool results as signals requiring triage, not automatic delete proof.
