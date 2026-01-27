---
name: ai-commit
description: Generate atomic Commitizen-style commit messages from staged git diffs. Use when the user asks to create a commit message, write a commit, or needs help with git commit messages. Automatically analyzes staged changes and produces properly formatted conventional commit messages with appropriate type, scope, and description.
---

# AI Commit Message Generator

Generate atomic, well-structured commit messages following Conventional Commits and Commitizen conventions.

**🚨 CRITICAL: Maximum 50 characters for subject line - THIS IS NON-NEGOTIABLE 🚨**

## Commit Message Format

**Structure:**
```
<type>(<scope>): <subject>
```

**THE MOST IMPORTANT RULE:**
- **Subject line MUST be ≤50 characters total** (including type, scope, colon, everything)
- **COUNT BEFORE OUTPUTTING** - If >50, make it shorter
- **NO BODY TEXT** - 99% of commits don't need it, just output the subject line

**Other rules:**
- Use imperative mood ("add", "fix", "update" - not "added", "fixes", "updating")
- Be specific and atomic - describe exactly what this commit changes
- Focus on the staged diff content, not branch names or prior work
- Scope is optional but recommended for clarity

## NEVER Do in Commit Messages

**⚠️ LENGTH VIOLATIONS (HIGHEST PRIORITY - THESE CAUSE IMMEDIATE FAILURE):**
- NEVER EVER exceed 50 characters total for the entire subject line
- NEVER write long descriptions - be brutally concise or it will be rejected
- NEVER add body text - just output the subject line
- NEVER explain in detail - commit message is not documentation
- NEVER use long words when short words work ("implement" → "add", "initialize" → "init")

**Format violations:**
- NEVER use past tense ("added", "fixed", "updated") - use imperative mood
- NEVER reference branch names in commit message ("merge feature-branch", "from develop")
- NEVER write vague subjects like "fix bug", "update code", "changes"
- NEVER describe HOW the code works - describe WHAT changed
- NEVER include multiple unrelated changes in one commit (suggest splitting)
- NEVER write commit messages in future tense ("will add", "will fix")
- NEVER capitalize the first letter of subject after the scope (lowercase only)
- NEVER add periods at the end of subject line

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
4. **Draft subject line** - Imperative, specific
5. **COUNT CHARACTERS** - Verify total length ≤50 chars (including type, scope, colon, space, and subject)
6. **If >50 chars**: Abbreviate aggressively - remove articles, use shorter verbs, compress scope
7. **Verify format** - Check length, mood, and conventional commit structure
8. **Add body only if needed** - Most commits should NOT have a body

## Character Counting Examples

**Good (47 chars):**
```
feat(auth): add password reset via email
```

**Too long (58 chars) - FAILS:**
```
feat(auth): add password reset functionality via email link
```

**Corrected (42 chars):**
```
feat(auth): add password reset via email
```

**Good with scope (35 chars):**
```
fix(AB#123): prevent null in login
```

**Too long (64 chars) - FAILS:**
```
fix(AB#123): prevent null pointer exception in user login validation
```

**Corrected (44 chars):**
```
fix(AB#123): prevent null in user login
```

## Output

**⚠️ ABSOLUTE REQUIREMENTS - FAILURE TO COMPLY IS UNACCEPTABLE ⚠️**

1. **COUNT EVERY SINGLE CHARACTER** in the subject line
2. **IF >50 CHARACTERS, SHORTEN IT** - No exceptions, no excuses
3. Output ONLY the subject line - **DO NOT output body text** (99% of commits don't need it)
4. No markdown, no code blocks, no explanations, no preamble
5. No periods at the end

**Character counting is MANDATORY:**
- Count: type + ( + scope + ) + : + space + subject
- Example: `feat(auth): add reset` = 23 chars ✓
- Example: `fix(AB#123): handle null` = 26 chars ✓
- **If your count shows >50, STOP and make it shorter**

**Abbreviation strategies when too long:**
- Remove articles: "add the validation" → "add validation"
- Use shorter verbs: "implement" → "add", "initialize" → "init"
- Compress scope: "authentication" → "auth"
- Remove redundant words: "fix bug in" → "fix"

**WRONG (will be rejected):**
```
feat(authentication): implement comprehensive password reset functionality with email verification
```
(91 characters - UNACCEPTABLE)

**CORRECT:**
```
feat(auth): add password reset
```
(30 characters - PERFECT)
