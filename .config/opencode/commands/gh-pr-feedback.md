---
description: Extract actionable feedback from GitHub PR reviews with line references
agent: quick
---

Extract and act on GitHub PR review feedback.

Input:
- `$ARGUMENTS` may be a PR URL, PR number, review link, discussion link, or empty.
- If empty, infer the PR from the current branch.

Pre-flight:
1. Use the script-generated context below as the source of truth.
2. If context starts with `ERROR:`, output only that error and stop.
3. Do not infer missing metadata that is not present in context.

Tool routing:
1. For the final user-choice prompt, call the built-in `question` tool directly.
2. Do not run tool-discovery/reconciliation steps (`toolbox_search_*`, `toolbox_status`, `sequential-thinking`) for this command.
3. If `question` call fails once, stop retrying and output the same choices in plain text.

SCRIPT-GENERATED REVIEW CONTEXT:
!`sh -c 'OPENCODE_LIBEXEC_CWD="$PWD" bun --cwd "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/libexec" "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/libexec/gh_pr_feedback_context.ts" all "$1" 2>/dev/null || OPENCODE_LIBEXEC_CWD="$PWD" bun --cwd "$HOME/dotfiles/.config/opencode/libexec" "$HOME/dotfiles/.config/opencode/libexec/gh_pr_feedback_context.ts" all "$1" 2>/dev/null || echo "ERROR: Missing gh_pr_feedback_context.ts"' -- "$ARGUMENTS"`

Workflow:
1. Parse `SCRIPT-GENERATED REVIEW CONTEXT` JSON.
2. Validate expected top-level keys exist: `pr`, `threads`, `proposedResolve`, `proposedIrrelevant`, `keepOpen`.
   - If one is missing, output: `ERROR: Invalid review context payload` and stop.
   - Do not attempt to reconstruct missing fields.
3. Summarize unresolved actionable feedback from `threads`.
4. Use current session context about already-applied fixes to refine proposals:
   - Keep proposals conservative.
   - Never propose `resolved` from same-file edits alone.
   - Prefer false negatives over false positives.
5. Keep separate buckets:
   - `Proposed resolve` for likely addressed items.
   - `Proposed resolve as irrelevant` for outdated/no-longer-relevant items.
   - `Keep open` for everything else.
6. Keep ordering deterministic within each bucket:
   - Sort by severity (`request-changes`, `should-fix`, `nit`, `info`), then by `path`, then by first line number.
7. For every proposed item, include a short resolution comment text explaining how/why it was addressed or why it is irrelevant.
   - Prefer `resolutionNote` from context when present.
8. Apply confidence gate for high-severity feedback:
   - If `severity=request-changes` and confidence is not `high`, default that item to `Keep open`.
   - Only move it to `Proposed resolve` after explicit user confirmation.

Output format:
- Start with PR context line:
  - `PR: <url> (<owner>/<repo>#<number>)`
- Then include four flat bullet sections in this order:
  - `Actionable feedback`
  - `Proposed resolve`
  - `Proposed resolve as irrelevant`
  - `Keep open`
- If a section has no entries, include `- None`.
- Bullet format:
  - `` `path:line-range` <full feedback text> [threadId=... commentId=...] ``
  - Append metadata when available: `[severity=...] [confidence=...] [corroboratedBy=...]`.
  - Append `(outdated)` when flagged.
  - Keep reviewer wording verbatim for direct fix requests.
  - Preserve markdown/code fences from feedback excerpts.
  - If feedback text is very long, show a concise excerpt and append `[truncated]`.
  - Keep full text in a `Full text (truncated items)` appendix at the end.
- For each proposed resolve/irrelevant bullet, append:
  - `Reason: <why it appears addressed/irrelevant>`
  - `Resolution comment: <comment text to post before resolving>`

Resolve policy:
- Do not resolve anything automatically.
- End by calling the built-in `question` tool (not plain text) with exactly:
  - Header: `PR feedback next step`
  - Question: `What should I do with this feedback?`
  - Options (stable labels):
    - `Apply fixes now`
    - `Resolve proposed threads`
    - `Create a todo list here`
    - `Write a markdown checklist file`
    - `Keep as-is (no follow-up action)`
  - Use single-select (`multiple: false`) with custom input allowed.

When user selects `Resolve proposed threads`:
1. Re-list the proposed thread IDs that will be resolved.
   - Exclude any item where `threadId` is missing/null.
   - Reclassify excluded items to `Keep open` with reason: `missing threadId; cannot resolve via API`.
2. For each thread, post the paired `Resolution comment` first.
   - Default to context `resolutionNote` when available.
3. Resolve the thread only after the comment is posted successfully.
4. Report per-thread status: `commented+resolved`, `comment failed`, `already resolved`, or `failed`.

Never:
- Never include resolved threads in actionable output.
- Never include agent/tool logs in feedback bullets.
- Never merge unrelated comments into one bullet.
- Never resolve any thread without a preceding explanatory comment.
