# Ship Failures Reference

Use this reference when any delivery phase fails or when commit/push permissions block shipping.

## Failure Matrix

| Phase | Failure | Immediate Action | Output Requirement |
|---|---|---|---|
| Intake | Issue missing/inaccessible | Verify id/workspace; stop | Show requested id and exact access blocker |
| Intake | URL malformed | Extract id if possible, else request explicit id | Show parsing attempt and next required input |
| Branch | Invalid branch name | Sanitize and retry once | Show before/after branch names |
| Branch | Worktree already exists | Switch to existing worktree | Show chosen worktree and branch |
| Branch | Detached HEAD | Switch to intended branch before edits | Show current vs target branch |
| Validation | Formatter/lint command missing | Run available checks, report gap | Mark validation as partial with reason |
| Shipping | Commit denied | Stop shipping; provide exact commit command | Provide ready commit message text |
| Shipping | Push denied | Stop push; provide exact push command | Keep PR state as not opened |
| Shipping | PR API fails | Keep branch state, output PR payload | Include title/body/base/head for retry |

## Permission-Denied Contract

When policy denies commit/push:

1. State `blocked_by_policy: true`.
2. Name exact blocked command.
3. Continue non-blocked steps only.
4. Provide a copy/paste next command.

Never present blocked shipping as complete.
