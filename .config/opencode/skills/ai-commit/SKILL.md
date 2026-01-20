---
name: ai-commit
description: Generate atomic Commitizen messages from staged diffs.
---

## Rules
- Types: feat|fix|docs|style|refactor|perf|test|build|ci|chore.
- Imperative mood ("add", "fix", "update", not "added", "fixes").
- <72 chars total.
- Describe this commit's staged changes only.
- Be specific and atomic, like a changelog entry.
- Focus on what changed in the diff, not branch name or prior work.
- If a ticket number is provided in context, scope must be AB#<ticket>.

## Examples
- fix(AB#50147): prevent null pointer in user validation
- feat(AB#50147): add email field to registration form
- refactor(AB#50147): extract validation logic to helper function
- test(AB#50147): add edge case tests for empty input

## Output
- Commit message only; no markdown or explanations.
