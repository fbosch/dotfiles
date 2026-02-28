---
description: Generate a Commitizen commit message for staged changes
model: github-copilot/grok-code-fast-1
---

Output ONLY a single-line Commitizen commit message (≤50 chars). Stop immediately after. No explanation, no preamble, no markdown. Format: `<type>(<scope>): <subject>`

Example: `feat(parser): support multiline values`

Branch: !`git rev-parse --abbrev-ref HEAD`
Previous commit: !`git log -1 --pretty=format:"%s" 2>/dev/null`
Arguments: $ARGUMENTS

**Types:** feat, fix, docs, style, refactor, perf, test, build, ci, chore

**Scope:** Use ticket number as `AB#<n>` if present in branch name or arguments, otherwise use module/feature name.

**Rules:**

- Imperative mood: "add", "fix", "update" — not "added", "fixes"
- Specific and atomic — describe exactly what this commit changes
- No past tense, no future tense, no periods at end
- No vague subjects like "fix bug" or "update code"
- Lowercase first letter of subject after scope
- Ignore pure style changes (whitespace, formatting, indentation, trailing commas) unless they are the only changes — if mixed with substantive changes, describe the substance only
- Do not prefix output with any label (`Commit Message:`, `**Commit message:**`, `COMMIT MESSAGE:`, etc.)
- If the diff below is empty (only lock or generated files were staged), output exactly: `chore(deps): update lock file`

**LENGTH ENFORCEMENT — NON-NEGOTIABLE:**

Keep ≤50 chars. If over: shorten scope (authentication→auth), compress verbs (implement→add), drop articles, abbreviate (function→fn).

**Output:** ONLY the commit message. First character must be the commit type. No markdown blocks, no explanations, no questions.

STAGED DIFF:
!`git diff --cached --ignore-all-space -- ':!*-lock.*' ':!*.lock'`
