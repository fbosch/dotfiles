---
description: Extract actionable feedback from GitHub PR reviews with line references
model: anthropic/claude-sonnet-4-6
agent: general
---

Extract and act on GitHub PR review feedback.

## Input

- Default mode: `$ARGUMENTS` contains a PR URL, number, or review link. If empty, infer from current branch.
- Resolve mode: if the first argument is `resolve`, treat the rest of `$ARGUMENTS` as optional PR context and resolve candidates based on prior session context about what the agent already fixed.
- Resolve mode must use the current session context; do not ignore earlier messages that describe applied fixes.

## Workflow

1. **Parse mode first**
   - If the first argument is exactly `resolve`, run the resolve workflow below.
   - Otherwise, run the default summarize workflow below.
   - In resolve mode, do not ask the user to restate what was fixed; inspect prior session context first.

2. **Default summarize workflow**
   - **Identify the PR**
     - If user provides a PR URL, extract owner/repo/number.
     - If user provides a direct review or thread link (e.g., `https://github.com/<owner>/<repo>/pull/<number>#pullrequestreview-<review_id>` or `#discussion_r<comment_id>`), extract owner/repo/number and the review or comment id for targeted fetching.
     - If user provides just a number, assume current repo and confirm by fetching PR details.
     - If no PR is provided, infer from current branch name using GitHub MCP tools or `gh pr view --json number,url`.
     - If user provides an opencode tool-output transcript or file that already contains parsed review comments, treat it as the primary source and avoid re-fetching via `gh api` unless fields are missing.
     - Include all comments by default, including informational and non-actionable comments (except excluded automated summaries), and label them as informational when needed.
   - **Fetch review metadata**
     - Prefer GitHub MCP tools.
     - Use `gh pr view <number> --json number,title,url` only as fallback context.
     - If a review URL is provided, fetch it with the matching MCP tool or `gh api repos/<owner>/<repo>/pulls/<number>/reviews/<review_id>`.
     - If a direct review link is provided, confirm the review id matches and use it to scope comments.
   - **Fetch review comments and threads**
     - Prefer `github_pull_request_read` with `get_review_comments`.
     - Fall back to `gh api repos/<owner>/<repo>/pulls/<number>/comments --paginate` only when GitHub MCP data is unavailable or incomplete.
     - If targeting a specific review, filter by `pull_request_review_id`.
     - If targeting a specific thread/comment id from `#discussion_r<comment_id>`, filter to that comment and any replies in its thread.
     - Reconstruct threads by grouping comments using `in_reply_to_id` and include the root comment with all replies.
     - For each thread, read the full discussion before extracting feedback.
     - Preserve thread identity for later follow-up whenever available: `threadId`, root `commentId`, `path`, `line`, `startLine`, `isResolved`, `isOutdated`.
     - Fetch general PR comments only when user explicitly asks for them or when no inline review comment covers the same issue: `github_pull_request_read` with `get_comments` or `gh api repos/<owner>/<repo>/issues/<number>/comments --paginate` as fallback.
     - If a parser script is provided (for example in an opencode tool-output path), run it first and use its output to populate thread groups and comment fields.
     - For opencode tool-output JSON, use `scripts/parse-review-comments.py` to normalize thread groups before summarizing.
       - Example: `python scripts/parse-review-comments.py /path/to/tool-output.json`
   - **Summarize actionable feedback**
     - For each comment, capture:
       - `path` and `line` or `start_line`/`line` if present.
       - The core actionable request or concern.
       - Whether the comment is outdated or on a deleted/renamed file.
       - De-duplicate repeated points.
       - Include the full feedback text from the reviewer; do not shorten or condense it.
       - Identify similar feedback across reviewers and note it as corroboration (e.g., "also raised by @user2").
       - For automated agent comments that include long analysis chains or tool logs, exclude the analysis/log sections and only keep the actionable feedback or fix request itself.
       - For automated overview summaries (e.g., Copilot PR overview) that do not request changes, treat them as non-actionable and exclude them.
       - If a comment mixes background summary with actionable requests, keep only the actionable portion and preserve original wording.
       - Preserve original markdown formatting within actionable excerpts (code blocks, links, emphasis) when present.
       - Render code suggestions inside fenced code blocks (```) to preserve readability.
       - When the same issue is raised by multiple comments, merge them after severity ordering into a single item and note that it was mentioned by multiple authors (e.g., "Mentioned by Copilot and CodeRabbit").
       - When thread IDs are available, include them in a compact machine-usable metadata block after the human summary so resolve mode can reuse them later.

3. **Resolve workflow**
   - **Goal**
     - Propose which unresolved review threads are now addressed by prior agent fixes in this session, explain the reasoning for each proposal, and ask for confirmation before resolving anything.
   - **Identify the PR**
     - Use the remaining arguments after `resolve` the same way as default mode.
     - If no PR is provided, infer it from the current branch.
   - **Fetch unresolved review threads**
     - Prefer GitHub MCP review-thread data first.
     - Fetch the current unresolved inline review comments and preserve `threadId`, `commentId`, `path`, `line`, `startLine`, `body`, `author`, `isResolved`, and `isOutdated`.
     - If the available GitHub MCP tools do not expose a thread-resolve mutation or do not return resolvable thread IDs, stop before mutation and state that limitation clearly.
   - **Infer which threads were addressed**
     - Use prior session context as the primary source of truth for what the agent fixed.
     - Compare each unresolved thread against the fixes already described or applied earlier in the session.
     - Prefer exact matches in this order: same file, same symbol/code path, same requested behavior, same nearby line range.
     - Only propose a thread when the evidence is strong; if the match is ambiguous, leave it unresolved.
     - Never treat a thread as addressed merely because the same file changed.
   - **Explain the proposal**
     - For every proposed resolution, include:
       - `path:line-range`
       - reviewer request text
       - why the earlier fix appears to satisfy it
       - any caveat that lowers confidence
       - `threadId` when available
     - For unresolved or ambiguous threads, say why they are being left open.
   - **Ask for confirmation before mutating**
     - Use the `question` tool before any resolve call.
     - Header: `Resolve PR threads`
     - Question: `Resolve the proposed review threads now?`
     - Options (keep labels stable):
       - `Resolve proposed threads`
       - `Show proposals only`
       - `Keep all threads unresolved`
     - Use single-select (`multiple: false`) and allow custom input.
     - If the answer is anything other than `Resolve proposed threads`, do not mutate GitHub state.
   - **Resolve threads after confirmation**
     - Prefer a GitHub MCP resolve-thread mutation when available.
     - If MCP can read review threads but cannot resolve them in the current runtime, do not silently fall back; explain that MCP resolution is unavailable and stop unless the user explicitly asks for a `gh api` fallback.
     - If and only if the user explicitly asked for `gh api` fallback in the conversation, use `gh api graphql` after the confirmation step.
     - Resolve by `threadId`, not by comment id.
     - Report results as `resolved`, `already resolved`, `skipped`, or `failed`.

## Prioritization mindset

- Prefer user-impacting issues over stylistic or internal refactors
- When two items are similar severity, surface the one with broader blast radius first
- If a comment is informational only, note it as non-actionable
- Prefer review comments (inline) over general PR comments when both exist for the same issue
- If multiple reviewers conflict, prioritize request-changes over comments and note the conflict explicitly
- Exclude resolved threads and comments; only include current actionable feedback
- In resolve mode, prefer false negatives over false positives; it is better to leave a thread open than resolve the wrong one

## Output format

- In default mode:
  - Use a flat bullet list.
  - Each bullet should include: `path:line-range` + full feedback text.
  - If a file/line is missing, use `path:unknown`.
  - Do not include links in the output; the PR URL is enough context.
  - Order by severity if clear (request-changes > should-fix > nit), then by file path.
  - If severity is unclear, group by reviewer role (maintainers > collaborators > external) and then by file path.
  - Preserve the reviewer's wording when it is a direct request.
  - Do not output resolved threads at all.
  - For outdated threads, append `(outdated)` to the bullet.
  - Keep code fences inside the bullet so list structure stays intact.
  - When available, append compact metadata for later resolution, for example ` [threadId=PRRT_xxx commentId=12345]`.
  - Decision rules:
    - If resolved, exclude.
    - If outdated and unresolved, include and append `(outdated)`.
    - If line/path missing, use `path:unknown`.
    - For duplicates with different line ranges, use common sense based on the feedback at hand.
    - Do not merge conflicting requests; keep them separate and flag the conflict.
  - Example bullet with code suggestion:
    - `src/app.ts:42` Please handle empty input before parsing. [threadId=PRRT_xxx]
      ```ts
      if (input.trim().length == 0) {
        return null;
      }
      ```
  - Example informational-only bullet:
    - `src/app.ts:12` Informational: This change looks good; no action needed.
  - End by calling the `question` tool (do not print a plain-text `Question:` block) with:
    - Header: `PR feedback next step`
    - Question: `What should I do with this feedback?`
    - Options (keep labels stable):
      - `Apply fixes now`
      - `Resolve addressed threads`
      - `Create a todo list here`
      - `Write a markdown checklist file`
      - `Keep as-is (no follow-up action)`
    - Use single-select (`multiple: false`) and allow custom input.
    - If there are conflicting requests, add a heads-up sentence before the final question.
    - If writing a reference file, write a Markdown file with checkbox list items so progress can be tracked.
    - Example reference file format:
      - `# PR Feedback`
      - `- [ ] src/app.ts:42 Handle empty input before parsing. [threadId=PRRT_xxx]`
- In resolve mode:
  - Use a flat bullet list split into `Proposed resolve` and `Keep open` items.
  - Each bullet must include `path:line-range` plus the reasoning.
  - Include `threadId` for each proposed resolution when available.
  - State clearly whether GitHub MCP is available for resolution.
  - Do not resolve anything until after the confirmation question is answered.

## Notes

- Prefer the GitHub MCP tools when available; fall back to `gh` CLI JSON APIs
- Mention explicitly in the response when GitHub MCP tools were used
- In resolve mode, prefer MCP for both reading and resolving review threads
- In resolve mode, use `gh api` only when the user explicitly asked for that fallback
- Keep summaries verbatim; do not modify or condense the feedback content
- If any context is missing (owner/repo), ask for it only after trying to infer from current git remote
- Helper scripts:
  - `scripts/inspect-review-json.py` prints structure and key fields
  - `scripts/parse-review-comments.py` outputs thread-grouped JSON
  - `scripts/list-review-comments.py` prints comments with key fields
- GitHub MCP tool mapping:
  - Identify PR / metadata: `github_pull_request_read` (method: `get`)
  - Review metadata: `github_pull_request_read` (method: `get_reviews`)
  - Review comments (inline): `github_pull_request_read` (method: `get_review_comments`)
  - General PR comments: `github_pull_request_read` (method: `get_comments`)
  - PR files (for context/paths): `github_pull_request_read` (method: `get_files`)
- Resolve review threads: use the GitHub MCP resolve-thread mutation if the runtime exposes one; otherwise stop before mutation unless the user explicitly asked for `gh api` fallback

## Never

- Never paraphrase a direct fix request unless it improves clarity without changing meaning; accuracy beats polish
- Never include agent analysis chains, tool logs, or execution transcripts in the output; only keep the actionable feedback
- Never include automated overview summaries that contain no actionable requests
- Never include non-actionable background summaries when a comment also contains an explicit action
- Never drop file/line context when it exists; the location is essential for action
- Never merge unrelated comments into one bullet; keep review intent separable
- Never omit outdated‑comment status when it is flagged in the review data; it prevents wasted effort
- Never include resolved threads; user has already acted on them
- Never treat outdated-but-open threads as resolved; include them and mark as `(outdated)`
- Never resolve a thread without first explaining why it appears addressed and asking for confirmation
- Never resolve a thread based only on a same-file edit; require a stronger match to the actual request
- Never silently fall back from GitHub MCP to `gh api` in resolve mode
