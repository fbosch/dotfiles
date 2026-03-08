---
description: Generate a Commitizen commit message for staged changes
agent: commit
---

$ARGUMENTS

Generate a single Commitizen-style commit subject for the staged diff.

Rules:
- Output only the commit subject (no markdown, no quotes, no explanation).
- Target format: <type>(<scope>): <subject>
- Maximum length: 50 characters.
- If adding (<scope>) would push the message over 50 chars, omit the scope and use: <type>: <subject>
- Keep the subject concise and imperative.

Branch: !`git rev-parse --abbrev-ref HEAD`
Previous commit: !`git log -1 --pretty=format:"%s" 2>/dev/null`

STAGED DIFF:
!`git diff --cached --ignore-all-space -- ':!*-lock.*' ':!*.lock'`
