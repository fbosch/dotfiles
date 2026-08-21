---
description: Generate a Commitizen commit message for staged changes
agent: commit
---

$ARGUMENTS

Generate commit metadata for the staged diff.

Rules:
- Output only one JSON object with `type`, `scope`, and `subject`.
- Keep the formatted message `type(scope): subject` at most 50 characters.
- Preserve a ticket scope detected in the branch or arguments.
- Keep the subject concise, complete, and imperative; rewrite rather than truncate.

Branch: !`git rev-parse --abbrev-ref HEAD`
Previous commit: !`git log -1 --pretty=format:"%s" 2>/dev/null`

STAGED DIFF:
!`git diff --cached --ignore-all-space -- ':!*-lock.*' ':!*.lock'`
