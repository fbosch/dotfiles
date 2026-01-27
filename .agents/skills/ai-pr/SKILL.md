---
name: ai-pr
description: Generate concise PR descriptions from git diffs and commit context. Use when the user asks to create a PR description, write a pull request summary, or needs help documenting changes for code review. Automatically analyzes git diffs and commit history to produce well-structured PR descriptions with summary, changes, testing info, and breaking changes.
---

# AI Pull Request Description Generator

Generate clear, concise PR descriptions from git diffs and commit messages.

## Core Principles

**Short and scannable beats comprehensive:**
- PRs are scanned in 30 seconds - every word must earn its place
- Reviewers should understand the change without reading code
- Less is more - cut ruthlessly

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

## NEVER Do in PR Descriptions

- NEVER write more than necessary - if you can say it in 5 words instead of 10, do it
- NEVER use marketing language ("enhanced", "optimized", "robust", "improved", "powerful")
- NEVER include "this PR" or "this change" (redundant in PR context)
- NEVER explain HOW the code works - describe WHAT behavior changed
- NEVER add emojis or visual flair
- NEVER write in first person ("I added", "We fixed") - use imperative
- NEVER include aspirational features not yet implemented
- NEVER list trivial changes (formatting, whitespace, import reordering)
- NEVER exceed 5 bullets in Changes section (be selective - 3 is better)
- NEVER write full paragraphs - use concise bullets
- NEVER write introductory phrases ("This section describes..." - just describe it)
- NEVER repeat information between Summary and Changes sections
- NEVER guess at breaking changes - only include if obviously visible in diff

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

**Before writing, ask:**
1. Can I say this in fewer words?
2. Does this bullet add information or just take space?
3. Would a reviewer understand this in 5 seconds?

**Summary section:**
- Max 2 short sentences (1 is better if sufficient)
- Describe the overall goal or problem solved
- Present tense, active voice
- Cut unnecessary words ruthlessly

**Changes section:**
- **Target 3-4 bullets** (5 is maximum, not goal)
- Each bullet under 10 words (12 is absolute max)
- List only substantive functional changes
- Order by importance/impact
- If you have >5 changes, the PR is probably too large - focus on the most important

**Testing section:**
- Be brief: `npm test` beats "Run the test suite using npm test"
- List test commands or file names, nothing more
- Use "- Not stated" if no testing info available

**Breaking Changes section:**
- Include only when diff obviously breaks existing behavior
- One line per breaking change - no elaboration unless critical
- Use "- None" if no breaking changes

## Good vs Bad Examples

**Good (concise, scannable):**
```
feat(auth): add password reset

## Summary
Add password reset flow with email verification.

## Changes
- Add `POST /auth/reset` endpoint
- Send reset email via SendGrid
- Add `ResetPassword` UI component

## Testing
- `npm test`
- Manual test with test@example.com

## Breaking Changes
- None
```

**Bad (verbose, hard to scan):**
```
feat(auth): enhance authentication system with password reset functionality

## Summary
This PR implements a comprehensive password reset feature that will allow 
users to reset their passwords when they forget them. The implementation 
includes both backend API endpoints and frontend UI components, and it has 
been thoroughly tested to ensure reliability.

## Changes
- This change implements a new POST endpoint at /auth/reset which handles 
  password reset requests from users who have forgotten their passwords
- We have integrated with the SendGrid email service to send password reset 
  emails to users, which includes a secure token
- A new ResetPassword component has been created in the frontend to provide 
  users with an intuitive interface for resetting their passwords
- Updated the authentication flow to support the new password reset feature
- Added comprehensive error handling for edge cases

## Testing
- Ran the full test suite using the command `npm test` and verified that all 
  tests pass successfully
- Performed extensive manual testing with the test account test@example.com 
  to ensure the feature works correctly in real-world scenarios

## Breaking Changes
- None at this time
```

The good example takes 10 seconds to read. The bad example takes 45+ seconds and adds no extra information.

## Examples

**Feature PR:**
```
feat(AB#50147): add email validation to registration

## Summary
Add email format validation and uniqueness check.

## Changes
- Add `validateEmail` to `utils/validators.ts`
- Check email format in `RegistrationForm`
- Add unique email constraint to schema

## Testing
- `npm test`
- Manual test with invalid emails

## Breaking Changes
- None
```

**Bug Fix PR:**
```
fix(AB#50271): prevent null pointer in user profile

## Summary
Fix crash when profile data is missing.

## Changes
- Add null check for `user.profile.avatar`
- Set default avatar when missing

## Testing
- Add test for null profile
- Verify no crash

## Breaking Changes
- None
```

**Refactoring PR:**
```
refactor(AB#50198): extract validation to shared module

## Summary
Move validation functions to shared module.

## Changes
- Create `utils/validators.ts`
- Update `LoginForm` and `RegistrationForm`
- Remove duplicate code

## Testing
- Existing tests pass

## Breaking Changes
- None
```

**PR with breaking changes:**
```
feat(AB#50299): migrate to new authentication API

## Summary
Update to v2 API endpoints.

## Changes
- Replace `/auth/login` with `/v2/auth/token`
- Update response parsing for new format
- Add token refresh flow

## Testing
- Integration tests with v2 API

## Breaking Changes
- Old `/auth/login` endpoint removed
- Tokens require refresh after 1 hour
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
