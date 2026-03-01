---
description: Generate a Commitizen commit message for staged changes
agent: commit
---

Branch: !`git rev-parse --abbrev-ref HEAD`
Previous commit: !`git log -1 --pretty=format:"%s" 2>/dev/null`
Arguments: $ARGUMENTS

STAGED DIFF:
!`git diff --cached --ignore-all-space -- ':!*-lock.*' ':!*.lock'`
