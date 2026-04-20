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

SCRIPT-GENERATED REVIEW CONTEXT:
!`sh -c 'if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/scripts/gh-pr-feedback-context.sh" ]; then bash "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/scripts/gh-pr-feedback-context.sh" "$1"; elif [ -f "$HOME/dotfiles/.config/opencode/scripts/gh-pr-feedback-context.sh" ]; then bash "$HOME/dotfiles/.config/opencode/scripts/gh-pr-feedback-context.sh" "$1"; else echo "ERROR: Missing gh-pr-feedback-context.sh"; fi' -- "$ARGUMENTS"`

Workflow:
1. Parse `SCRIPT-GENERATED REVIEW CONTEXT` JSON.
2. Summarize unresolved actionable feedback from `threads`.
3. Use current session context about already-applied fixes to refine proposals:
   - Keep proposals conservative.
   - Never propose `resolved` from same-file edits alone.
   - Prefer false negatives over false positives.
4. Keep separate buckets:
   - `Proposed resolve` for likely addressed items.
   - `Proposed resolve as irrelevant` for outdated/no-longer-relevant items.
   - `Keep open` for everything else.
5. For every proposed item, include a short resolution comment text explaining how/why it was addressed or why it is irrelevant.

Output format:
- Start with PR context line:
  - `PR: <url> (<owner>/<repo>#<number>)`
- Then include three flat bullet sections in this order:
  - `Actionable feedback`
  - `Proposed resolve`
  - `Proposed resolve as irrelevant`
  - `Keep open`
- Bullet format:
  - `` `path:line-range` <full feedback text> [threadId=... commentId=...] ``
  - Append `(outdated)` when flagged.
  - Keep reviewer wording verbatim for direct fix requests.
  - Preserve markdown/code fences from feedback excerpts.
- For each proposed resolve/irrelevant bullet, append:
  - `Reason: <why it appears addressed/irrelevant>`
  - `Resolution comment: <comment text to post before resolving>`

Resolve policy:
- Do not resolve anything automatically.
- End by calling the `question` tool (not plain text) with:
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
2. For each thread, post the paired `Resolution comment` first.
3. Resolve the thread only after the comment is posted successfully.
4. Report per-thread status: `commented+resolved`, `comment failed`, `already resolved`, or `failed`.

Never:
- Never include resolved threads in actionable output.
- Never include agent/tool logs in feedback bullets.
- Never merge unrelated comments into one bullet.
- Never resolve any thread without a preceding explanatory comment.
