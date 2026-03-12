# Worktrunk Workflow

Use Worktrunk tools for this repo's worktree workflow.

## Preferred tools

- Use `worktrunk-list` to inspect branches/worktrees.
- Use `worktrunk-status` to check the current branch/worktree state.
- Use `worktrunk-create` to create and switch to a new branch/worktree.
- Use `worktrunk-switch` to move between existing branch/worktrees.

## Safety

- Treat `worktrunk-remove` as destructive; only use it when the user explicitly asks.
- Prefer read-only checks (`worktrunk-list`, `worktrunk-status`) before mutating operations.
- Validate intent before irreversible branch/worktree changes.

## Conventions

- `@` means current branch where supported by Worktrunk.
- If `wt` is unavailable, fall back to read-only `git worktree list`.
- Keep operations non-interactive (`--yes`/equivalent) when available.
