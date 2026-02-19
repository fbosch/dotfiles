---
description: Generate a PR description comparing current branch against main/master
model: github-copilot/claude-haiku-4.5
subtask: true
---

Generate a PR description in English (markdown) for the branch below.

Branch: !`git rev-parse --abbrev-ref HEAD`
Base: !`git show-ref --verify --quiet refs/heads/main && echo main || echo master`
Commits: !`git log $(git merge-base HEAD $(git show-ref --verify --quiet refs/heads/main && echo main || echo master) 2>/dev/null)..HEAD --pretty=format:"%s" --no-merges 2>/dev/null`

**Output format:**

Line 1: `<type>(#<ticket>): <description>` — max 72 chars, present tense
Line 2: blank
Line 3+: Markdown PR body

**Sections (use exactly these headings):**

## Summary
## Changes
## Testing
## Breaking Changes

**Hard limits:**
- Summary: 1 sentence, max 14 words
- Changes: 2–5 bullets, max 10 words each
- Testing: 1 bullet — command or "Not stated"
- Breaking Changes: 1 bullet — "None" unless obvious in diff
- Total output: 26 lines max

**Length calibration:**
- Small PR (≤3 files, ≤2 commits): 2 bullets
- Medium PR (4–10 files or 3–6 commits): 3–4 bullets
- Large PR (>10 files or >6 commits): 4–5 bullets

**Rules:**
- Plain verbs: add, remove, change, fix, update
- No marketing language, no filler, no paragraphs
- No first person, no "this PR"
- Describe only visible changes
- Skip trivial edits (formatting, whitespace, reorders)
- Do not repeat Summary content in Changes

**Strict output:** Output ONLY the PR content. First character must be the PR title. No preface, no "Here is", no "Intent:".

DIFF (may be truncated for large PRs — focus on commits and file list above):
$ARGUMENTS
