---
name: ai-commit
description: Generate atomic Commitizen-style commit messages from staged git diffs. Use when the user asks to create a commit message, write a commit, or needs help with git commit messages. Automatically analyzes staged changes and produces properly formatted conventional commit messages with appropriate type, scope, and description.
---

# AI Commit Message Generator

Generate atomic, well-structured commit messages following Conventional Commits and Commitizen conventions.

## Commit Message Format

**Structure:**
```
<type>(<scope>): <subject>

[optional body]
```

**Rules:**
- Total length < 72 characters for subject line
- Use imperative mood ("add", "fix", "update" - not "added", "fixes", "updating")
- Be specific and atomic - describe exactly what this commit changes
- Focus on the staged diff content, not branch names or prior work
- Scope is optional but recommended for clarity

## NEVER Do in Commit Messages

- NEVER use past tense ("added", "fixed", "updated") - use imperative mood
- NEVER reference branch names in commit message ("merge feature-branch", "from develop")
- NEVER write vague subjects like "fix bug", "update code", "changes"
- NEVER exceed 72 characters on subject line
- NEVER describe HOW the code works - describe WHAT changed
- NEVER include multiple unrelated changes in one commit (suggest splitting)
- NEVER write commit messages in future tense ("will add", "will fix")
- NEVER capitalize the first letter of subject after the scope (lowercase only)

## NEVER Do in Commit Messages

- NEVER use past tense ("added", "fixed", "updated") - use imperative mood
- NEVER reference branch names in commit message ("merge feature-branch", "from develop")
- NEVER write vague subjects like "fix bug", "update code", "changes"
- NEVER exceed 72 characters on subject line
- NEVER describe HOW the code works - describe WHAT changed
- NEVER include multiple unrelated changes in one commit (suggest splitting)
- NEVER write commit messages in future tense ("will add", "will fix")
- NEVER capitalize the first letter of subject after the scope (lowercase only)

**Types:**
- `feat`: New feature or functionality
- `fix`: Bug fix
- `docs`: Documentation changes only
- `style`: Code style/formatting (no logic changes)
- `refactor`: Code restructuring (no behavior change)
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `build`: Build system or dependencies
- `ci`: CI/CD configuration changes
- `chore`: Maintenance tasks

## Scope Guidelines

**When ticket numbers are provided:**
- Use format: `AB#<ticket-number>`
- Example: `fix(AB#50147): prevent null pointer in validation`

**When no ticket number:**
- Use module/feature name
- Examples: `feat(auth): add password reset`, `fix(api): handle timeout errors`

**When changes span multiple areas:**
- Use broader scope or omit scope
- Example: `refactor: standardize error handling across services`

## Examples

**Feature addition:**
```
feat(AB#50147): add email field to registration form

Include validation for email format and uniqueness check
```

**Bug fix:**
```
fix(AB#50147): prevent null pointer in user validation

Add null check before accessing user.profile object
```

**Refactoring:**
```
refactor(AB#50147): extract validation logic to helper

Move validation functions to utils/validators.ts for reuse
```

**Test addition:**
```
test(AB#50147): add edge case tests for empty input

Cover null, undefined, and empty string scenarios
```

**Documentation:**
```
docs(api): update authentication endpoint examples

Add JWT token format and refresh token flow details
```

**Simple change:**
```
fix(AB#50271): correct timezone offset calculation
```

## Process

1. **Analyze the staged diff** - Review what files changed and how
2. **Determine the type** - Based on what changed (feat/fix/refactor/etc)
3. **Identify the scope** - Use ticket number if available, otherwise module name
4. **Write subject line** - Imperative, specific, < 50 chars
5. **Add body if needed** - For complex changes, explain why or how (optional)
6. **Verify format** - Check length, mood, and conventional commit structure

## Output

Provide ONLY the commit message text. No markdown formatting, no explanations, no preamble.

If the commit is simple, output just the subject line. If more context is needed, include a blank line and body.
