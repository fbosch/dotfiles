---
description: Generate a Commitizen commit message for staged changes
agent: commit
---

Generate exactly one Conventional Commit subject line.

Rules:
- Output only the commit subject line, no extra text.
- Maximum length: 50 characters.
- Format: `type(scope): subject` (scope optional).
- Use imperative mood (`add`, `fix`, `refactor`, `docs`, `test`, `chore`).
- No trailing period, no quotes, no markdown, no code fences.
- If needed to fit 50 chars, shorten wording and drop scope first.
- Before responding, count characters; if over 50, rewrite until <=50.

Branch: !`git rev-parse --abbrev-ref HEAD`
Previous commit: !`git log -1 --pretty=format:"%s" 2>/dev/null`

STAGED DIFF:
!`git diff --cached --ignore-all-space -- ':!*-lock.*' ':!*.lock'`
