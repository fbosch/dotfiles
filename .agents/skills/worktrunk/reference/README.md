# Worktrunk Reference

Reference material for the Worktrunk skill.

Worktrunk is a CLI for managing Git worktrees through branch-oriented commands. In this dotfiles repo, it is used to keep parallel agent or feature work in separate working directories.

## Useful Commands

- `wt list` shows known worktrees and branch state.
- `wt status` shows the current worktree state.
- `wt switch <branch>` switches to an existing worktree.
- `wt switch --create <branch>` creates and switches to a new worktree.
- `wt remove` removes a worktree and should be treated as destructive.

## Local Rules

- Prefer `wt` over direct mutating `git worktree` commands.
- Use read-only checks before switching or creating worktrees.
- Do not run `wt remove` unless the user explicitly asks for cleanup.
- Keep branch names focused, for example `fix/*`, `feature/*`, or `refactor/*`.

## Upstream Docs

- Full documentation: <https://worktrunk.dev>
- GitHub: <https://github.com/max-sixty/worktrunk>
- Native Git worktree docs: <https://git-scm.com/docs/git-worktree>
