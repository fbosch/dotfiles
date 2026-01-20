---
name: ai-pr
description: Generate concise PR descriptions from git diffs and commit context.
---

## Instructions
- Omit trivial changes entirely (formatting-only, whitespace, comment removal, import reordering, empty lines).
- Include only functional code changes, bug fixes that change behavior, new features, API/config changes, tests, significant docs.

## Language rules
- Plain technical language (no marketing: avoid "enhanced", "optimized", "robust").
- Lexical level = CEFR B1: short, common words; max 12 words per sentence.
- Prefer simple verbs: added/removed/changed/fixed/updated.
- Describe only what the diff or commits explicitly show; never guess intent.
- For fixes: mention what was broken only if visible, plus how diff fixes it.
- For other changes: state what changed from/to; include reasons only when explicitly stated.
- Prefer lists; use backticks for `files`/`functions`/`APIs`.
- Keep each bullet under 12 words for readability.

## Structure
- Title: use commit type and ticket from context (present tense, concise).
- Summary section: max 2 short sentences describing overall change.
- Changes section: bullet list (max 5 items). Only substantive changes.
- Testing section: bullet list; mention commands or "- Not stated".
- Breaking Changes section: include only when diff obviously breaks behavior.

## Output
- First line is the PR title only.
- Blank line after title.
- Then markdown PR description using the provided section headings.
- Output only the final content, no explanations.
