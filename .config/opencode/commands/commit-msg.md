---
description: Generate a Commitizen commit message for staged changes
model: github-copilot/claude-haiku-4.5
allowedTools:
  - read
---

Output a single-line Commitizen commit message (≤50 chars) for these staged changes. Format: `<type>(<scope>): <subject>`

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

**LENGTH ENFORCEMENT — NON-NEGOTIABLE:**

Before outputting, COUNT your commit message characters. If >50:
1. Shorten scope: "authentication"→"auth", "database"→"db"
2. Compress verbs: "implement"→"add", "initialize"→"init", "configure"→"config"
3. Remove articles: "the", "a", "an"
4. Use abbreviations: "function"→"fn", "parameter"→"param"

Examples (with char counts):
- `feat(auth): add user login flow` (31 chars) ✓
- `feat(authentication): implement user authentication system` (59 chars) ✗
- `feat(auth): add user auth system` (34 chars) ✓

**Output:** ONLY the commit message. First character must be the commit type. No markdown blocks, no explanations, no questions.

STAGED DIFF:
!`git diff --cached`
