---
description: Generate a PR description comparing current branch against its base branch
agent: quick
---

Write a PR description in English. Output markdown only.

Use the auto-generated git context below.

Pre-flight:
1. Use only the injected context from `AUTO-GENERATED GIT CONTEXT` and `ADDITIONAL CONTEXT`.
2. If base branch detection failed (`Base: (not found)`), respond only:
`Cannot generate PR description: unable to determine base branch.`
3. If merge-base detection failed (`(failed to determine merge base)`), respond only:
`Cannot generate PR description: unable to determine merge base.`

PR BODY POLICY (authoritative for body content only):
@~/.config/opencode/skills/pr-description/SKILL.md

Follow this precedence order:
1. Title format and title types from this command
2. PR body structure and content rules from `pr-description` skill
3. If there is a conflict, command hard limits win

**Output format:**

Line 1: `<type>: <description>` — max 72 chars, present tense
Line 2: blank
Line 3+: Markdown PR body

Use one of these title types: feat, fix, refactor, chore, docs, test

**Hard limits:**

- Changes: 2-5 bullets
- Total output: 36 lines max

**Rules:**

- Apply all PR body structure, section, and writing rules from the skill
- Treat injected git context as an invocation-time snapshot; do not infer missing repo state
- Ignore merge commits in the Commits context
- Ignore changes that appear only because of merges
- Ignore formatting, whitespace, and import reordering
- Do not explain your reasoning
- Do not add commentary after the last section

**Example output:**

fix: handle base branch comparison for ai-pr

## Summary

Use upstream comparison when generating PR descriptions from master.

## Changes

- Detect upstream branch for main and master
- Compare diffs against upstream instead of local branch
- Keep failure message for missing upstream

**Strict output:** Output ONLY the PR content. First character must be the PR title. No preface, no "Here is", no "Intent:", no extra headings.

AUTO-GENERATED GIT CONTEXT:
!`sh -c '
branch=$(git rev-parse --abbrev-ref HEAD)
base=""

if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  base=$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null || true)
fi

if [ -z "$base" ]; then
  for ref in origin/main origin/master main master; do
    if git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null; then
      base=$ref
      break
    fi
  done
fi

echo "Branch: $branch"

if [ -z "$base" ]; then
  echo "Base: (not found)"
  echo "Commits:"
  echo "(failed to determine base branch)"
  echo
  echo "DIFF:"
  git diff --ignore-all-space -- ':!*-lock.*' ':!*.lock'
  exit 0
fi

merge_base=$(git merge-base HEAD "$base" 2>/dev/null || true)

echo "Base: $base"
echo "Commits:"

if [ -z "$merge_base" ]; then
  echo "(failed to determine merge base)"
  echo
  echo "DIFF:"
  git diff --ignore-all-space -- ':!*-lock.*' ':!*.lock'
  exit 0
fi

commits=$(git log --no-merges --pretty=format:"- %s" "$merge_base..HEAD")
if [ -n "$commits" ]; then
  printf "%s\n" "$commits"
else
  echo "(none)"
fi

echo
echo "DIFF:"
git diff --ignore-all-space "$merge_base..HEAD" -- ':!*-lock.*' ':!*.lock'
'`

ADDITIONAL CONTEXT (optional):
$ARGUMENTS
