---
name: gh-pr-feedback
description: Summarize actionable feedback from GitHub pull request reviews and review comments using the gh CLI. Use when asked to read PR feedback, review threads, or actionable items from a PR link/number, and produce a concise, line-referenced list of issues and suggestions.
---

# Gh PR Feedback

Extract actionable feedback from a GitHub PR review and present it with file paths, line ranges, and links to each discussion.

## Workflow

1. Identify the PR
   - If user provides a PR URL, extract owner/repo/number.
   - If user provides just a number, assume the current repo and confirm by fetching PR details.
   - If no PR is provided, infer from current branch name using GitHub MCP tools or `gh pr view --json number,url`.

2. Fetch review metadata
   - Use `gh pr view <number> --json number,title,url` for context.
   - If a review URL is provided, fetch it with `gh api repos/<owner>/<repo>/pulls/<number>/reviews/<review_id>`.

3. Fetch review comments
   - Use `gh api repos/<owner>/<repo>/pulls/<number>/comments --paginate`.
   - If targeting a specific review, filter by `pull_request_review_id`.

4. Summarize actionable feedback
   - For each comment, capture:
     - `path` and `line` or `start_line`/`line` if present
     - The core actionable request or concern
     - The discussion URL
   - Whether the comment is outdated or on a deleted/renamed file
   - De-duplicate repeated points.
   - Identify similar feedback across reviewers and note it as corroboration (e.g., “also raised by @user2”).

## Prioritization mindset

- Prefer user-impacting issues over stylistic or internal refactors.
- When two items are similar severity, surface the one with broader blast radius first.
   - If a comment is informational only, note it as non-actionable.
   - Prefer review comments (inline) over general PR comments when both exist for the same issue.
   - If multiple reviewers conflict, prioritize request-changes over comments and note the conflict explicitly.
   - Exclude resolved threads and comments; only include current actionable feedback.

## Output format

- Use a flat bullet list
- Each bullet should include: `path:line-range` + short summary + link
- If a file/line is missing, use `path:unknown` and keep the comment link
- Order by severity if clear (request‑changes > should‑fix > nit), then by file path
- If severity is unclear, group by reviewer role (maintainers > collaborators > external) and then by file path
- Preserve the reviewer’s wording when it is a direct request
- Do not output resolved threads at all
- For outdated threads, append `(outdated)` to the bullet

## Notes

- Prefer the GitHub MCP tools when available; fall back to `gh` CLI JSON APIs.
- Mention explicitly in the response when GitHub MCP tools were used.
- Keep summaries tight; do not modify the feedback content, only condense when needed for clarity.
- If any context is missing (owner/repo), ask for it only after trying to infer from current git remote.

## Never

- Never paraphrase a direct fix request unless it improves clarity without changing meaning; accuracy beats polish.
- Never drop file/line context when it exists; the location is essential for action.
- Never merge unrelated comments into one bullet; keep review intent separable.
- Never omit outdated‑comment status when it is flagged in the review data; it prevents wasted effort.
- Never include resolved threads; user has already acted on them.
- Never treat outdated-but-open threads as resolved; include them and mark as `(outdated)`.
