---
name: test-pruner
description: "Audit and safely clean low-value, redundant, misleading, flaky, over-mocked, or AI-generated unit tests. Use when asked to clean useless tests, prune test suites, remove redundant tests, audit low-value tests, improve test signal, clean brittle snapshots, reduce test noise, review coverage theater, or decide whether tests should be kept, rewritten, consolidated, moved, quarantined, or deleted."
---

# Test Pruner

Delete false confidence, not useful protection. Tests are code: remove or rewrite them only when their maintenance cost exceeds their regression and documentation value.

## Operating Mode

Default to **audit-only**. Do not delete or rewrite non-generated tests until the user approves the proposed actions.

Use **safe-cleanup** only after approval, and only for high-confidence items. Use **deep audit** when configured tooling exists or risk is high: mutation testing, `necessist`, assertion-density scripts, flake history, or coverage reports.

## Workflow

1. Scope target files, test framework, test command, changed files, and production code under test.
2. Capture baseline: `git status`, relevant test results, known failures, and configured coverage/mutation tools.
3. Inventory tests: map each test to behavior, production unit, assertions, mocks, snapshots, skips, runtime, and fixtures.
4. Classify each suspect test with `KEEP`, `REWRITE`, `CONSOLIDATE`, `MOVE LEVEL`, `DELETE`, or `QUARANTINE`.
5. Require evidence before deletion. Coverage stability alone is never evidence enough.
6. Prefer preserving unique behavioral intent by merging edge-case data into stronger tests before removing duplicates.
7. Validate affected tests before and after any approved cleanup. Run broader suite when shared fixtures/helpers changed.
8. Report actions, evidence, validation, and remaining risk.

## Evidence Gate

Before marking `DELETE`, show at least two evidence types:

- No unique behavior compared with a stronger test.
- No meaningful assertion or assertion cannot fail for wrong behavior.
- SUT is fully mocked or bypassed.
- Feature/contract is removed, dead, or obsolete.
- Snapshot is unreviewable and duplicates explicit assertions.
- Test is flaky or slow and lower-level or stronger coverage exists.
- Tool-backed signal: survived mutant, removable statement, assertion-density failure, or repeated flake history.

## Safety Rules

- Never delete failing tests blindly; first decide whether they expose a real regression.
- Never delete public API, compatibility, migration, serialization, security, or bug-regression tests just because they look simple.
- Never delete a duplicate until unique data or edge cases are merged or proven irrelevant.
- Never blindly update snapshots; replace behavior-relevant snapshots with explicit assertions.
- Never quarantine without owner, issue or TODO, expiry, and fix/delete path.
- Treat AI-generated tests as suspicious, not worthless.
- If deletion risk is unclear, return an audit report and ask for approval.

## References

- Read [rubric.md](references/rubric.md) before classifying tests for `DELETE`, `REWRITE`, `CONSOLIDATE`, `MOVE LEVEL`, or `QUARANTINE`.
- Read [patterns.md](references/patterns.md) when a test shows weak assertions, mocked SUT, duplicate behavior, brittle snapshots, flaky behavior, obsolete behavior, or AI-generated test smells.
- Use [report-template.md](references/report-template.md) for audit reports with multiple findings or any proposed deletion.
- Do not load [patterns.md](references/patterns.md) for a single obvious generated artifact or naming-only question.
- Do not load [report-template.md](references/report-template.md) for quick yes/no triage unless deletion is proposed.
