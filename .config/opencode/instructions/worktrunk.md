# Worktrunk Workflow

Use the `wt` CLI directly for this repo's worktree workflow.

## Preferred Commands

- Use `wt list` to inspect branches/worktrees.
- Use `wt status` to check the current branch/worktree state.
- Use `wt switch --create <branch>` to create and switch to a new branch/worktree.
- Use `wt switch <branch>` to move between existing branch/worktrees.
- Do not use mutating `git worktree` commands directly (`add`, `remove`, `move`, `prune`, `lock`, `unlock`, `repair`).

## Safety

- Treat `wt remove` as destructive; only use it when the user explicitly asks.
- Prefer read-only checks (`wt list`, `wt status`) before mutating operations.
- Validate intent before irreversible branch/worktree changes.

## Conventions

- `@` means current branch where supported by Worktrunk.
- If `wt` is unavailable, only use read-only `git worktree list`.
- Keep operations non-interactive (`--yes`/equivalent) when available.
