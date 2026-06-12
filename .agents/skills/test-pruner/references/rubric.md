# Test-Pruning Rubric

## Action Taxonomy

| Action | Use when | Preferred next step |
|---|---|---|
| `KEEP` | Test protects current behavior, public contract, bug regression, or high-risk edge case | Leave untouched; note why if it looked suspect |
| `REWRITE` | Intent is valuable but assertion, mock use, setup, or coupling is weak | Preserve scenario; verify observable behavior through real code |
| `CONSOLIDATE` | Scenario overlaps stronger tests but has unique input or edge case | Merge unique data, then remove duplicate |
| `MOVE LEVEL` | Unit test is actually integration/contract behavior, or broad test should move lower | Replace at better level before removal |
| `DELETE` | No unique signal, no current behavior, mock-only theater, obsolete snapshot, or generated artifact | Delete only after evidence gate and approval |
| `QUARANTINE` | Flaky but potentially valuable and not immediately fixable | Add owner, issue/TODO, expiry, and fix/delete plan |

## Value Questions

Ask for every suspect test:

- What bug would this catch?
- Does it execute production code or only mocks/fakes?
- Does it assert observable output, state, or contract?
- Does it encode current desired behavior?
- Does it protect a public API, migration, serialization format, security rule, or known regression?
- Is this behavior already covered by a stronger test?
- Would the test fail if the implementation were wrong in a realistic way?

## Cost Questions

- Is it slow enough to discourage local or CI feedback?
- Is it flaky, time-dependent, network-dependent, random, or sleep-based?
- Does it break on refactors with no behavior change?
- Does it require large fixtures or broad setup unrelated to the assertion?
- Does it duplicate implementation instead of behavior?
- Is snapshot diff reviewable by a human?

## Severity

| Severity | Meaning | Examples |
|---|---|---|
| P0 | False confidence | Mocked SUT, assertion-free, unconditional skip, test passes after assertion removal |
| P1 | Important but weak | Over-mocked dependency chain, implementation-coupled assertions, missing negative path |
| P2 | Maintenance drag | Duplicate setup, giant snapshots, mystery fixtures, slow avoidable setup |
| P3 | Cleanup polish | Redundant descriptions, style drift, minor naming/readability |

## Deep Evidence

Use tool-backed checks when available and worth the cost:

- Mutation testing: survived mutants suggest weak or missing assertions.
- Necessist or statement removal: removed calls/assertions that still pass suggest redundant setup or ineffective tests.
- Assertion-density scans: zero assertions, log-only checks, empty catches, blank identifier assignments.
- Flake history: repeated retries, quarantine history, nondeterministic failures.

Treat tool results as signals requiring triage, not automatic delete proof.
