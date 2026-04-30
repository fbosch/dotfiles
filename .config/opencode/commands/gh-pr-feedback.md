---
description: Extract actionable feedback from GitHub PR reviews with line references
agent: quick
---

Extract and act on GitHub PR review feedback.

Input:

- `$ARGUMENTS` may be a PR URL, PR number, review link, discussion link, or empty.
- If empty, infer the PR from the current branch.

Pre-flight:

1. Call `gh_pr_feedback_context` with `input: "$ARGUMENTS"` and use its returned context as the source of truth for PR/review metadata only.
2. If context starts with `ERROR:`, output only that error and stop.
3. Do not infer missing metadata that is not present in context.

Tool routing:

1. For PR feedback context, call the `gh_pr_feedback_context` tool directly.
2. For user-choice prompts, call the built-in `question` tool directly.
3. Do not run tool-discovery/reconciliation steps (`toolbox_search_*`, `toolbox_status`, `sequential-thinking`) for this command.
4. If `question` call fails once, stop retrying and output the same choices in plain text.
5. During evidence validation, delegate when it materially improves confidence:
   - Use the `analyze` subagent for feedback that requires tracing existing code behavior, data flow, call chains, state transitions, or interactions across files.
   - Use the `research` subagent for feedback that depends on external documentation, GitHub/project history, third-party API behavior, platform behavior, or current best practices.
   - Do not delegate for simple single-file checks or obvious local facts; inspect those directly.
   - Subagents must validate claims and return evidence only; they must not edit files or resolve threads.

TOOL-GENERATED REVIEW CONTEXT:
Call `gh_pr_feedback_context` with `input: "$ARGUMENTS"`.

Workflow:

1. Parse `TOOL-GENERATED REVIEW CONTEXT` JSON.
2. Validate expected top-level keys exist: `pr`, `threads`, `proposedResolve`, `proposedIrrelevant`, `keepOpen`.
   - If one is missing, output: `ERROR: Invalid review context payload` and stop.
   - Do not attempt to reconstruct missing fields.
3. Treat each feedback item as an unverified claim, not as fact.
4. Summarize unresolved actionable feedback from `threads`.
5. Run an evidence gate before proposing code changes or resolution:
   - Validate doubtful or non-obvious claims up front by inspecting referenced code, current diff, relevant tests/docs, or running the smallest targeted check.
   - Validation is required when feedback asserts runtime behavior, correctness, security, performance, missing coverage, stale code paths, or when confidence is not `high`.
   - Prefer `analyze` for multi-file code-behavior validation and `research` for external-source validation when those apply.
   - Do not edit files during the evidence gate.
   - Record what was checked as `Evidence` for every proposed resolve/irrelevant item.
   - If a claim is disproven, propose `resolve as irrelevant` with a comment explaining why the feedback does not apply.
   - If a claim cannot be validated with available context, keep it open and state what validation is missing.
6. Use current session context about already-applied fixes to refine proposals:
   - Keep proposals conservative.
   - Never propose `resolved` from same-file edits alone.
   - Prefer false negatives over false positives.
7. Keep separate buckets:
   - `Proposed resolve` for likely addressed items.
   - `Proposed resolve as irrelevant` for outdated, disproven, or no-longer-relevant items.
   - `Keep open` for everything else.
8. Keep ordering deterministic within each bucket:
   - Sort by severity (`request-changes`, `should-fix`, `nit`, `info`), then by `path`, then by first line number.
9. For every proposed item, include a short resolution comment text explaining how/why it was addressed or why it is irrelevant.
   - Prefer `resolutionNote` from context when present and consistent with validated evidence.
   - For irrelevant items, the comment must cite the validating evidence, not merely say the feedback is irrelevant.
10. Apply confidence gate for high-severity feedback:

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
  - `Evidence: <what was checked before proposing this>`
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

Post-fix policy:

- After applying PR feedback fixes, do not commit, push, or resolve threads automatically.
- Re-run the feedback classification using the current session context and applied changes.
- Ask the user what follow-up actions to take by calling the built-in `question` tool with exactly:
  - Header: `PR feedback follow-up`
  - Question: `Fixes are applied. What follow-up actions should I take?`
  - Options (stable labels):
    - `Commit changes`
    - `Push branch`
    - `Resolve relevant threads`
    - `No follow-up action`
  - Use multi-select (`multiple: true`) with custom input allowed.
- If the user selects `Commit changes`, inspect git status/diff first, then commit only relevant changes.
- If the user selects `Push branch`, push only after confirming there are commits to push or an already-committed local branch state.
- If the user selects `Resolve relevant threads`, follow `When user selects Resolve relevant threads after fixes` below.
- If both `Commit changes` and `Push branch` are selected, commit first, then push.
- If `No follow-up action` is selected with other actions, treat `No follow-up action` as ignored and perform the selected concrete actions.

When user selects `Resolve proposed threads`:

1. Re-list the proposed thread IDs from `Proposed resolve` and `Proposed resolve as irrelevant` that will be resolved.
   - Exclude any item where `threadId` is missing/null.
   - Reclassify excluded items to `Keep open` with reason: `missing threadId; cannot resolve via API`.
2. For each thread, post the paired `Resolution comment` first.
   - Default to context `resolutionNote` only when it is consistent with validated evidence.
   - For irrelevant items, do not post a resolution comment unless it cites why the feedback does not apply.
3. Resolve the thread only after the comment is posted successfully.
4. Report per-thread status: `commented+resolved`, `comment failed`, `already resolved`, or `failed`.

When user selects `Apply fixes now`:

1. Re-run the evidence gate for any selected item without recorded `Evidence`.
2. Only edit code for feedback whose claimed issue is confirmed and relevant.
3. If validation disproves a claim, do not edit for it; move it to `Proposed resolve as irrelevant` with an evidence-backed resolution comment.
4. If validation is inconclusive, do not guess; keep it open and report the missing validation.

When user selects `Resolve relevant threads` after fixes:

1. Re-list the relevant proposed thread IDs that will be resolved.
   - Exclude any item where `threadId` is missing/null.
   - Reclassify excluded items to `Keep open` with reason: `missing threadId; cannot resolve via API`.
2. For each thread, post a resolution comment before resolving.
   - The comment must explain what changed and how it addressed the feedback.
   - Default to context `resolutionNote` when available, but update it if applied fixes changed the exact resolution.
3. Resolve the thread only after the comment is posted successfully.
4. Report per-thread status: `commented+resolved`, `comment failed`, `already resolved`, or `failed`.

Never:

- Never include resolved threads in actionable output.
- Never include agent/tool logs in feedback bullets.
- Never merge unrelated comments into one bullet.
- Never resolve any thread without a preceding explanatory comment.
- Never treat reviewer wording as proof that the claim is true.
- Never commit or push after applying fixes without explicit user selection from the post-fix question.
