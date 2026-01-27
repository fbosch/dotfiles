---
name: ai-pr
description: Generate concise PR descriptions from git diffs and commit context. Use when the user asks to create a PR description, write a pull request summary, or needs help documenting changes for code review. Automatically analyzes git diffs and commit history to produce well-structured PR descriptions with summary, changes, testing info, and breaking changes.
---

# AI Pull Request Description Generator

Generate extremely short PR descriptions from diffs and commits.

## Hard Limits

- Summary: 1 sentence, max 14 words
- Changes: 2-5 bullets, max 10 words each
- Testing: 1 bullet, command or "Not stated"
- Breaking Changes: 1 bullet, "None" unless obvious in diff
- Total output: 26 lines max

## Length Calibration

- Small PR (<=3 files and <=2 commits): 2 bullets
- Medium PR (4-10 files or 3-6 commits): 3-4 bullets
- Large PR (>10 files or >6 commits): 4-5 bullets

## Minimum Content

- Always include Summary and Changes
- Changes must include at least 2 bullets

## Rules

- Use plain verbs: add, remove, change, fix, update
- No marketing language, no filler, no paragraphs
- No first person, no "this PR"
- Describe only visible changes
- Skip trivial edits (formatting, whitespace, reorders)
- Do not repeat Summary content in Changes

## Output Format

1. Title line only
2. Blank line
3. Markdown body with headings

## Strict Output

- Output ONLY the PR content, nothing else
- Do NOT add prefaces like "Intent:" or "Here is"
- First character must be the PR title

Example:
```markdown
fix(AB#12345): prevent null crash in profile

## Summary
Fix crash when profile data is missing.

## Changes
- Add null guard in `profile.ts`
- Default missing avatar value

## Testing
- Not stated

## Breaking Changes
- None
```
