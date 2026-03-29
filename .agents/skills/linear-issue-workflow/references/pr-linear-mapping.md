# PR and Linear Mapping

Use this reference when preparing PR metadata or syncing issue status after PR creation.

## PR Title and Body Rules

## Title

Format:

`<ISSUE-ID>: <concise outcome>`

Example:

`ENG-123: enforce worktree branch sanitization before shipping`

## Body Template

```markdown
## Summary
- <what changed>
- <why this solves the issue>

## Validation
- <format/lint/test results>

## Linear
- Issue: <ISSUE-ID>
```

## Duplicate PR Check

Before creating a PR:

1. Check for an existing open PR for the same `head` branch.
2. If found, return existing PR URL.
3. Skip creating another PR.

## Linear State Suggestions

Use team conventions first. If unavailable, use this default:

- PR opened -> move issue to `In Review`
- PR merged -> move issue to `Done`
- PR blocked/failing checks -> keep in `In Progress` and add blocker comment

When state changes, include PR URL in the update.
