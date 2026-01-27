---
name: ai-pr
description: Generate concise PR descriptions from git diffs and commit context. Use when the user asks to create a PR description, write a pull request summary, or needs help documenting changes for code review. Automatically analyzes git diffs and commit history to produce well-structured PR descriptions with summary, changes, testing info, and breaking changes.
---

# AI Pull Request Description Generator

Generate clear, concise PR descriptions from git diffs and commit messages.

## Core Principles

**Focus on functional changes:**
- Include code behavior changes, bug fixes, new features, API changes, tests
- Omit trivial changes: formatting, whitespace, comment-only edits, import reordering

**Plain technical language:**
- Avoid marketing terms ("enhanced", "optimized", "robust", "improved")
- Use simple verbs: add, remove, change, fix, update
- Keep sentences under 12 words
- Use backticks for `files`, `functions`, `APIs`, `variables`

**Describe what is visible:**
- Only describe what the diff or commits explicitly show
- Never guess intent or future implications
- State what changed from/to
- Include reasons only when explicitly stated in commits

## PR Structure

```markdown
[Type]([Ticket]): [Brief Description]

## Summary
[1-2 sentences describing overall change]

## Changes
- [Functional change 1]
- [Functional change 2]
- [Functional change 3]

## Testing
- [Test approach or commands]
- Not stated (if no testing info available)

## Breaking Changes
- [Breaking change] (only if diff obviously breaks behavior)
- None (if no breaking changes)
```

## Title Format

Use commit type and ticket number from context:
- `feat(AB#12345): add user authentication`
- `fix(AB#12345): prevent null pointer in validation`
- `refactor(AB#12345): extract helper functions`
- `docs(AB#12345): update API examples`

If no ticket number:
- `feat: add user authentication`
- `fix: prevent crash on empty input`

## Writing Guidelines

**Summary section:**
- Max 2 short sentences
- Describe the overall goal or problem solved
- Present tense, active voice

**Changes section:**
- Max 5 bullets
- Each bullet under 12 words
- List only substantive functional changes
- Order by importance/impact

**Testing section:**
- List test commands run or test files added
- Mention testing approach if stated in commits
- Use "- Not stated" if no testing info available

**Breaking Changes section:**
- Include only when diff obviously breaks existing behavior
- Describe what breaks and how
- Use "- None" if no breaking changes

## Examples

**Feature PR:**
```
feat(AB#50147): add email validation to registration

## Summary
Add email format validation and uniqueness check to registration form.

## Changes
- Add `validateEmail` function to `utils/validators.ts`
- Update `RegistrationForm` to check email format
- Add unique email constraint to database schema
- Display error message for invalid or duplicate emails

## Testing
- Run `npm test` for unit tests
- Manual testing with valid/invalid email formats

## Breaking Changes
- None
```

**Bug Fix PR:**
```
fix(AB#50271): prevent null pointer in user profile

## Summary
Fix crash when accessing user profile with missing data.

## Changes
- Add null check before accessing `user.profile.avatar`
- Set default avatar when profile image is missing
- Update `ProfileCard` component error handling

## Testing
- Add test case for users without profile data
- Verify no crash with null profile

## Breaking Changes
- None
```

**Refactoring PR:**
```
refactor(AB#50198): extract validation to shared module

## Summary
Move validation functions to shared module for reuse across forms.

## Changes
- Create `utils/validators.ts` with shared functions
- Update `LoginForm` to use shared validators
- Update `RegistrationForm` to use shared validators
- Remove duplicate validation code

## Testing
- Existing tests pass with refactored code
- No behavior changes

## Breaking Changes
- None
```

**PR with breaking changes:**
```
feat(AB#50299): migrate to new authentication API

## Summary
Update authentication to use v2 API endpoints.

## Changes
- Replace `/auth/login` with `/v2/auth/token` endpoint
- Update auth response parsing for new format
- Add token refresh flow
- Update tests for new API

## Testing
- Integration tests with v2 API
- Manual testing of login and token refresh

## Breaking Changes
- Old `/auth/login` endpoint no longer supported
- Auth tokens now require refresh after 1 hour
```

## Process

1. **Analyze git diff** - Review changed files and specific code changes
2. **Review commit messages** - Extract context about intent and testing
3. **Identify type and scope** - Determine PR type (feat/fix/refactor) and ticket number
4. **Filter changes** - Exclude trivial formatting/whitespace changes
5. **List functional changes** - Focus on behavior changes, max 5 bullets
6. **Extract testing info** - From commits or test file changes
7. **Check for breaking changes** - Look for API/behavior changes
8. **Write concise description** - Follow structure, keep language simple

## Output Format

**CRITICAL:** Output ONLY the PR content. No explanatory text, thoughts, or meta-commentary.

1. First line: PR title only
2. Blank line
3. Markdown PR description with section headings
4. Nothing else

Do not add any preamble like "Here's the PR description:" or any analysis afterward.
