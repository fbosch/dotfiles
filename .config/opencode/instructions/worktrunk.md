# Worktrunk Workflow

Use Worktrunk plugin tools for this repo's worktree workflow.

## Preferred tools

- If Worktrunk plugin tools are available in this environment, use them for all worktree operations.
- Use `worktrunk-list` to inspect branches/worktrees.
- Use `worktrunk-status` to check the current branch/worktree state.
- Use `worktrunk-create` to create and switch to a new branch/worktree.
- Use `worktrunk-switch` to move between existing branch/worktrees.
- Do not use mutating `git worktree` commands directly (`add`, `remove`, `move`, `prune`, `lock`, `unlock`, `repair`).

## Safety

- Treat `worktrunk-remove` as destructive; only use it when the user explicitly asks.
- Prefer read-only checks (`worktrunk-list`, `worktrunk-status`) before mutating operations.
- Validate intent before irreversible branch/worktree changes.

## Conventions

- `@` means current branch where supported by Worktrunk.
- If `wt` is unavailable, only use read-only `git worktree list`.
- Keep operations non-interactive (`--yes`/equivalent) when available.
