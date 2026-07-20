---
description: Inspect current PR or branch CI failures and offer to diagnose and fix them
agent: debug
---

Inspect CI for the current pull request, or the current branch pipeline when no pull request exists, then offer to diagnose and fix confirmed failures.

Additional context:
$ARGUMENTS

Instructions:

1. Call `ci_failure_context` exactly once. Do not manually re-fetch PR, pipeline, check, or log data unless the tool reports a specific retrieval error that needs diagnosis.
2. If the tool output starts with `ERROR:`, report that error and stop. A missing pull request is handled by the tool as a branch-pipeline report, not an error.
3. Present the report exactly as returned. Do not infer a root cause beyond the reported evidence.
4. If the report contains failed checks, use the `question` tool to offer: `Diagnose and fix`, `Diagnose only`, or `Stop`.
5. For `Diagnose and fix`, follow the `diagnose` skill: inspect the relevant code and CI configuration, reproduce the failure when feasible, then make the smallest evidenced fix. Run the narrowest relevant validation. Do not commit, push, rerun, cancel, or modify remote CI.
6. For `Diagnose only`, identify the most likely cause, evidence, and highest-value next check without editing files.
7. If there are pending checks but no failures, report the current state and stop. Do not poll or wait for completion.
8. If no checks are failed or pending, report the current state and stop.
