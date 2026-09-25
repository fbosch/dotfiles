---
name: test-pruner
description: "Audit and improve unit tests for meaningful regression protection. Use for repository-wide or scoped test-quality audits, cleaning useless or redundant tests, improving weak assertions, pruning brittle snapshots, or deciding whether tests should be kept, rewritten, consolidated, moved, quarantined, or deleted."
---

# Test Pruner

Make every retained unit test worth its maintenance cost: it should protect meaningful behavior or catch a plausible regression. Do not optimize for test count or coverage percentage.

## Scope and authorization

- Match the requested scope. For a whole-repository audit, review **every** unit-test file and every test case, including skipped tests and unconventional locations. Do not stop at a sample. Name exclusions and unreviewed files; never claim completion for them.
- For a focused request, inventory and review only the requested area. Do not silently widen the scope.
- An audit-only request authorizes findings, not edits. An explicit request to improve or clean tests authorizes scoped rewrites, additions, and evidence-backed removals; it does not authorize production-code deletion. Ask before deleting when the request is unclear or the behavioral risk remains unresolved. Preserve unrelated work and production behavior.
- Work in manageable batches. If time, access, or tooling blocks completion, retain the ledger and report the unfinished scope rather than presenting a partial audit as complete.

## Establish the baseline

1. Read repository instructions and relevant scoped `AGENTS.md` files. Find test runners, CI and local commands, shared test utilities, production modules, and unit tests outside naming conventions.
2. Inventory the in-scope files, including skipped tests. Record excluded files and why. Capture `git status` and run a relevant baseline so pre-existing failures can be distinguished from changes introduced during cleanup.
3. For each file, read its individual test cases, the relevant production behavior, callers, and requirements or documentation. The implementation is not automatically the correct specification.

## Review and act

For **each test case**, identify its intended requirement, observable behavior or invariant; a plausible defect it would catch; whether wrong behavior could pass; whether a correct refactor would break it; and whether its unique value justifies its setup, duplication, and upkeep. Record a concise file-level rationale in the ledger, with case-level notes where decisions differ.

Classify suspect tests as `KEEP`, `REWRITE`, `CONSOLIDATE`, `MOVE LEVEL`, `DELETE`, or `QUARANTINE` using [rubric.md](references/rubric.md). For an ambiguous classification only, `typesafe_question` may provide a bounded `choice` among plausible actions plus `unclear`, based on a small non-sensitive summary of the requirement, test behavior, comparison tests, and evidence. Do not send source, secrets, private fixtures, or sensitive findings to the gateway. Treat its probability as a second opinion, never as deletion evidence, approval, or a substitute for reading code and running checks.

Look for circular expectations, mocked-away behavior, incidental internals or source-string checks, weak assertions, duplicated scenarios, framework-only checks, obsolete requirements, ineffective setup, and broad snapshots. When one appears, read the matching section of [patterns.md](references/patterns.md), not the whole reference by default. These are signals, not deletion rules: a once-only side effect, hardcoded mapping, mock interaction, or small snapshot can protect a contract.

Preserve unique behavior before removing duplicates. Keep an exact input when it is a boundary or regression witness: changing `1` to another positive integer, for example, can let a bug affecting only `1` pass. Change such values only when equivalent defect detection is demonstrated. Derive expectations independently from requirements, examples, or properties. Prefer observable results and meaningful side effects. Replace weak tests that are the only coverage of important behavior, and add boundary, failure-path, or domain-rule cases when the review exposes a credible gap. Keep tests deterministic, readable, focused, reasonably fast, and no more abstract than needed to understand expectations. Do not add speculative cases or mechanically replace every deletion.

## Removal and uncertainty gates

- Before `DELETE`, show at least two independent evidence types; two descriptions of the same duplication are one finding. A passing suite or stable coverage percentage alone does not justify deletion. Evidence may include:
  - No unique behavior compared with a stronger test, or no meaningful assertion that would fail for wrong behavior.
  - SUT mocked or bypassed; obsolete contract confirmed by requirements; or an unreviewable snapshot duplicating explicit assertions.
  - Flaky or slow test superseded by stronger coverage, or a targeted production mutation demonstrating what an assertion does or does not catch. Removing an assertion from a passing test is not evidence that it was useless.
- Never delete a failing test without determining whether it exposes a real regression. Do not discard public API, compatibility, migration, serialization, security, or bug-regression coverage merely because it is simple.
- If expected behavior is ambiguous or a likely production bug appears, record evidence and stop changing the affected expectation. Do not make the suite green by matching current behavior or deleting the test. Seek clarification where needed; continue independent files.
- Quarantine only with an owner, issue or TODO, expiry, and fix-or-delete path. Never blindly update snapshots. Treat AI-generated tests as suspects, not automatically worthless.

## Validate and account for every file

After each batch, update a ledger with **every inventoried file**. Each row needs separate fields for disposition (`pending`, `retained`, `improved`, `removed`, or `blocked`), proposed action, applied change, rationale, and verification. Write `none` for proposals or edits that did not occur; an `Action` field that mixes intent and execution is insufficient even in a single-file audit. Use `pending` for files awaiting review and `blocked` only for an actual impediment. Record skipped cases and case-level exceptions. A file is not reviewed merely because it was opened or its tests passed. Run focused tests after edits to tests, fixtures, or production code, or to investigate a specific uncertainty; otherwise reuse the baseline and record that no revalidation was needed. If shared fixtures or helpers change, run the affected broader suites. Run repository-required validation before finishing. For substantial rewrites, use a targeted temporary mutation or equivalent concrete check where practical to verify that the new assertion catches its intended defect; restore any temporary change.

Use [report-template.md](references/report-template.md) for multi-file audits or proposed deletions. Report scope, exclusions and unfinished work; main improvements and credible gaps filled; removals and why protection remains; suspected production bugs and unresolved requirements; baseline and final validation with pre-existing failures distinguished. Include the per-file ledger so completeness can be checked. Counts support the report but do not prove test quality.
