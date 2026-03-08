---
description: Generate a PR description comparing current branch against its base branch
model: anthropic/claude-haiku-4-5
---

Write a PR description in English. Output markdown only.

Branch: !`git rev-parse --abbrev-ref HEAD`
Base: !`branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); if [ "$branch" = main ] || [ "$branch" = master ]; then git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || printf '%s\n' "$branch"; elif git show-ref --verify --quiet refs/heads/main; then printf 'main\n'; else printf 'master\n'; fi`
Commits: !`branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); if [ "$branch" = main ] || [ "$branch" = master ]; then base=$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || printf '%s\n' "$branch"); else base=$(git show-ref --verify --quiet refs/heads/main && printf 'main\n' || printf 'master\n'); fi; git log $(git merge-base HEAD "$base" 2>/dev/null)..HEAD --pretty=format:"%s" --no-merges 2>/dev/null`

**Output format:**

Line 1: `<type>: <description>` — max 72 chars, present tense
Line 2: blank
Line 3+: Markdown PR body

Use one of these title types: feat, fix, refactor, chore, docs, test

**Sections (use exactly these headings):**

## Summary

## Changes

**Hard limits:**

- Summary: 1 sentence, 8-14 words
- Changes: 2–5 bullets, max 10 words each
- Total output: 24 lines max

**Length calibration:**

- Small PR (≤3 files, ≤2 commits): 2 bullets
- Medium PR (4–10 files or 3–6 commits): 3–4 bullets
- Large PR (>10 files or >6 commits): 4–5 bullets

**Rules:**

- Start each bullet with a plain verb: add, remove, change, fix, update
- No adjectives, no adverbs, no filler, no paragraphs
- No first person, no "this PR"
- Describe what changed in the code
- Ignore formatting, whitespace, and import reordering
- Do not repeat Summary content in Changes
- Do not explain your reasoning
- Do not add commentary after the last bullet

**Example output:**

fix: handle base branch comparison for ai-pr

## Summary
Use upstream comparison when generating PR descriptions from master.

## Changes
- Detect upstream branch for main and master
- Compare diffs against upstream instead of local branch
- Keep failure message for missing upstream

**Strict output:** Output ONLY the PR content. First character must be the PR title. No preface, no "Here is", no "Intent:", no extra headings.

DIFF (may be truncated for large PRs — focus on branch, base, commits, and diff):
$ARGUMENTS
