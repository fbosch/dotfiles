# Common Useless-Test Patterns

## Mocked SUT

Signal: the test mocks the module/function/class it claims to test, then asserts the mock return value or call count.

Fix: delete if it has no unique behavior. Rewrite if scenario matters by mocking only unmanaged dependencies and executing the real SUT.

## Assertion-Free Coverage Theater

Signal: test calls code without assertions, logs values, assigns results to discard variables, or only asserts no throw when behavior has outputs.

Fix: add behavior assertions if intent matters; otherwise delete.

## Weak Assertion

Signal: only `not null`, `truthy`, call count, snapshot of entire object, or generic error assertion.

Fix: assert named observable behavior, important fields, state transition, or exact contract.

## Duplicate Scenario

Signal: same behavior, same branch, same input class, or same assertion exists in a stronger test.

Fix: merge any unique edge-case data into strongest test, then delete duplicate.

## Trivial / Type-Enforced Test

Signal: getter/setter, constructor assignment, enum existence, DTO shape, or compile-time type rule with no runtime behavior.

Fix: delete unless it protects serialization, public compatibility, generated code, or a prior regression.

## Brittle Implementation Test

Signal: private method calls, internal call ordering, strict mocks, CSS selectors, exact DOM tree, large snapshots, or fixture internals.

Fix: rewrite through public interface and observable behavior. Delete only if stronger behavior coverage exists.

## Snapshot Creep

Signal: generic `renders component`, huge snapshots, dynamic timestamps/IDs, snapshot-only PRs, or snapshots nobody can review.

Fix: replace with explicit assertions, small named inline snapshots, custom serializers, or snapshot-diff. Delete orphaned or duplicate snapshots.

## Flaky Test

Signal: sleep-based timing, external network, shared mutable state, random data, order dependence, or repeated retry/quarantine history.

Fix: make deterministic if valuable. Move lower if better tested as unit/integration. Quarantine only with owner, issue/TODO, expiry, and fix/delete path.

## Obsolete Behavior

Signal: test protects removed feature, old migration path beyond support window, deprecated behavior past removal date, or dead code only reachable from tests.

Fix: delete test and dead code together when supported by product/history evidence.

## AI-Generated Test Smells

Signal: coverage threshold lowered, broad mocks/fakes added to inflate coverage, assertion weakened after failures, 3+ fix loops on same test, or tests that validate current bug.

Fix: audit assertion quality and expected behavior. Stop and ask if expected behavior is ambiguous.
