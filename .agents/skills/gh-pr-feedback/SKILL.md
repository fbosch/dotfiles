---
name: gh-pr-feedback
description: Extract actionable feedback from GitHub pull request reviews and review comments using the gh CLI. Use when asked to read PR feedback, review threads, or actionable items from a PR link/number, and produce a line-referenced list that includes the full feedback text and an end question about turning it into a todo list or reference file.
---

# Gh PR Feedback

Extract actionable feedback from a GitHub PR review and present it with file paths and line ranges.

## Workflow

1. Identify the PR
    - If user provides a PR URL, extract owner/repo/number.
    - If user provides a direct review or thread link (e.g., `https://github.com/<owner>/<repo>/pull/<number>#pullrequestreview-<review_id>` or `#discussion_r<comment_id>`), extract owner/repo/number and the review or comment id for targeted fetching.
    - If user provides just a number, assume the current repo and confirm by fetching PR details.
    - If no PR is provided, infer from current branch name using GitHub MCP tools or `gh pr view --json number,url`.
    - If the user provides an opencode tool-output transcript or file that already contains parsed review comments, treat it as the primary source and avoid re-fetching via `gh api` unless fields are missing.
    - Include all comments by default, including informational and non-actionable comments (except excluded automated summaries), and label them as informational when needed.

2. Fetch review metadata
   - Use `gh pr view <number> --json number,title,url` for context.
   - If a review URL is provided, fetch it with `gh api repos/<owner>/<repo>/pulls/<number>/reviews/<review_id>`.
   - If a direct review link is provided, confirm the review id matches and use it to scope comments.

3. Fetch review comments
    - Use `gh api repos/<owner>/<repo>/pulls/<number>/comments --paginate`.
    - If targeting a specific review, filter by `pull_request_review_id`.
    - If targeting a specific thread/comment id from `#discussion_r<comment_id>`, filter to that comment and any replies in its thread.
   - Reconstruct threads by grouping comments using `in_reply_to_id` and include the root comment with all replies.
   - For each thread, read the full discussion before extracting feedback.
    - Fetch general PR comments only when the user explicitly asks for them or when no inline review comment covers the same issue: `gh api repos/<owner>/<repo>/issues/<number>/comments --paginate`.
   - If a parser script is provided (for example in an opencode tool-output path), run it first and use its output to populate thread groups and comment fields.
   - For opencode tool-output JSON, use `scripts/parse-review-comments.py` to normalize thread groups before summarizing.
     - Example: `python scripts/parse-review-comments.py /path/to/tool-output.json`

4. Summarize actionable feedback
    - For each comment, capture:
      - `path` and `line` or `start_line`/`line` if present
      - The core actionable request or concern
      - Whether the comment is outdated or on a deleted/renamed file
      - De-duplicate repeated points.
      - Include the full feedback text from the reviewer; do not shorten or condense it.
      - Identify similar feedback across reviewers and note it as corroboration (e.g., “also raised by @user2”).
      - For automated agent comments that include long analysis chains or tool logs, exclude the analysis/log sections and only keep the actionable feedback or fix request itself.
      - For automated overview summaries (e.g., Copilot PR overview) that do not request changes, treat them as non-actionable and exclude them.
      - If a comment mixes background summary with actionable requests, keep only the actionable portion and preserve original wording.
      - Preserve original markdown formatting within actionable excerpts (code blocks, links, emphasis) when present.
      - Render code suggestions inside fenced code blocks (```) to preserve readability.
      - When the same issue is raised by multiple comments, merge them after severity ordering into a single item and note that it was mentioned by multiple authors (e.g., "Mentioned by Copilot and CodeRabbit").

## Prioritization mindset

- Prefer user-impacting issues over stylistic or internal refactors.
- When two items are similar severity, surface the one with broader blast radius first.
   - If a comment is informational only, note it as non-actionable.
   - Prefer review comments (inline) over general PR comments when both exist for the same issue.
   - If multiple reviewers conflict, prioritize request-changes over comments and note the conflict explicitly.
   - Exclude resolved threads and comments; only include current actionable feedback.

## Output format

- Use a flat bullet list
- Each bullet should include: `path:line-range` + full feedback text
- If a file/line is missing, use `path:unknown`
- Do not include links in the output; the PR URL is enough context.
- Order by severity if clear (request‑changes > should‑fix > nit), then by file path
- If severity is unclear, group by reviewer role (maintainers > collaborators > external) and then by file path
- Preserve the reviewer’s wording when it is a direct request
- Do not output resolved threads at all
- For outdated threads, append `(outdated)` to the bullet
- Keep code fences inside the bullet so list structure stays intact.
- Decision rules:
   - If resolved, exclude.
   - If outdated and unresolved, include and append `(outdated)`.
   - If line/path missing, use `path:unknown`.
   - For duplicates with different line ranges, use common sense based on the feedback at hand.
   - Do not merge conflicting requests; keep them separate and flag the conflict.
- Example bullet with code suggestion:
  - `src/app.ts:42` Please handle empty input before parsing.
    ```ts
    if (input.trim().length == 0) {
      return null;
    }
    ```
- Example informational-only bullet:
  - `src/app.ts:12` Informational: This change looks good; no action needed.
- End with a single question that presents explicit options:
  - "Choose one: (1) create a todo list in the agent, (2) write a reference file."
  - If there are conflicting requests, add a heads-up sentence before the final question.
  - If writing a reference file, write a Markdown file with checkbox list items so progress can be tracked.
  - Example reference file format:
    - `# PR Feedback`
    - `- [ ] src/app.ts:42 Handle empty input before parsing.`

## Notes

- Prefer the GitHub MCP tools when available; fall back to `gh` CLI JSON APIs.
- Mention explicitly in the response when GitHub MCP tools were used.
- Keep summaries verbatim; do not modify or condense the feedback content.
- If any context is missing (owner/repo), ask for it only after trying to infer from current git remote.
- Helper scripts:
  - `scripts/inspect-review-json.py` prints structure and key fields.
  - `scripts/parse-review-comments.py` outputs thread-grouped JSON.
  - `scripts/list-review-comments.py` prints comments with key fields.
 - GitHub MCP tool mapping:
   - Identify PR / metadata: `github_pull_request_read` (method: `get`).
   - Review metadata: `github_pull_request_read` (method: `get_reviews`).
   - Review comments (inline): `github_pull_request_read` (method: `get_review_comments`).
   - General PR comments: `github_pull_request_read` (method: `get_comments`).
   - PR files (for context/paths): `github_pull_request_read` (method: `get_files`).

## Never

- Never paraphrase a direct fix request unless it improves clarity without changing meaning; accuracy beats polish.
- Never include agent analysis chains, tool logs, or execution transcripts in the output; only keep the actionable feedback.
- Never include automated overview summaries that contain no actionable requests.
- Never include non-actionable background summaries when a comment also contains an explicit action.
- Never drop file/line context when it exists; the location is essential for action.
- Never merge unrelated comments into one bullet; keep review intent separable.
- Never omit outdated‑comment status when it is flagged in the review data; it prevents wasted effort.
- Never include resolved threads; user has already acted on them.
- Never treat outdated-but-open threads as resolved; include them and mark as `(outdated)`.
