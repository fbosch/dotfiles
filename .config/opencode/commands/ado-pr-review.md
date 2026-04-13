---
description: Review an Azure DevOps pull request by URL or PR id
agent: review
subtask: true
---

Review an Azure DevOps pull request from actual code changes.

PR input: $ARGUMENTS

If `$ARGUMENTS` is empty, output only:
`Usage: /ado-pr-review <pr-url-or-id>`

Fetched PR review context:
!`~/.config/opencode/scripts/fetch-ado-pr.sh "$ARGUMENTS"`

Instructions:

1. If fetched data starts with `ERROR:`, output only that error as-is.
2. Treat `diffs` as the source of truth for changed code.
3. Review code changes only. Do not summarize or react to PR discussion feedback.
4. Use thread/reviewer metadata only as optional context, never as review findings.
5. Follow the review agent output format exactly:
   - Review coverage
   - Overall verdict (ship, ship with fixes, or do not ship)
   - Findings sorted by severity
   - Positive observations
6. For each finding, include concrete evidence from diffs with `path:line` whenever possible.
7. If the PR includes tests in diffs, evaluate test coverage and edge-case handling first.
8. Do not mutate Azure DevOps state and do not propose posting comments automatically.

Strict output: Output only the final review.
