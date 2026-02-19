---
description: Generate a Commitizen commit message for staged changes
model: github-copilot/grok-code-fast-1
subtask: true
---

Generate a Commitizen commit message for the staged changes below.

Branch: !`git rev-parse --abbrev-ref HEAD`
Previous commit: !`git log -1 --pretty=format:"%s" 2>/dev/null`
Arguments (branch hint / ticket if provided): $ARGUMENTS

**ABSOLUTE REQUIREMENTS:**
1. Subject line MUST be ≤50 characters TOTAL (type + scope + colon + space + subject)
2. Format: `<type>(<scope>): <subject>`
3. Output ONLY the subject line — no explanations, no markdown, no body text
4. If >50 chars, abbreviate until ≤50

**Types:** feat, fix, docs, style, refactor, perf, test, build, ci, chore

**Scope:** Use ticket number as `AB#<n>` if present in branch name or arguments, otherwise use module/feature name.

**Rules:**
- Imperative mood: "add", "fix", "update" — not "added", "fixes"
- Specific and atomic — describe exactly what this commit changes
- No past tense, no future tense, no periods at end
- No vague subjects like "fix bug" or "update code"
- Lowercase first letter of subject after scope

**Character counting is mandatory:**
- Count: type + ( + scope + ) + : + space + subject
- If your count shows >50, STOP and make it shorter
- Abbreviation strategies: remove articles, use shorter verbs ("implement"→"add", "initialize"→"init"), compress scope ("authentication"→"auth")

**Output:** ONLY the subject line. First character must be the commit type. No preamble, no explanation.

STAGED DIFF:
!`git diff --cached`
