# Fish Configuration

Fish shell configuration for interactive work, dotfiles maintenance, and local workflow commands.

## Layout

- `config.fish` is the entrypoint.
- `aliases.fish`, `profile.fish`, `scripts.fish`, `coreutils.fish`, `gum.fish`, and `colors.fish` are sourced from the entrypoint.
- `private.fish` is local-only and not committed.
- `functions/` contains autoloaded Fish functions.
- `libexec/` contains TypeScript/Bun helpers used by wrapper functions.

## Function Groups

- OpenCode and agent workflow: `opencode.fish`, `ai_commit.fish`, `ai_pr.fish`, `linear_issue_workflow.fish`, profile/auth switching helpers.
- Worktree and branch helpers: `wt.fish`, `worktree_add.fish`, `worktree_clone.fish`, `latest_worktree.fish`, `wtfzf.fish`.
- Azure DevOps helpers: `ado_test_case.fish`, `ado_refinement_candidates.fish`, `workitems_on_date.fish`, `workitems_week.fish`, `workitems_cache_clear.fish`.
- Nix helpers: `flake_check_updates.fish`, `flake_update_interactive.fish`, `flake_updates_daemon.fish`, `flake_restore.fish`, `nxrb.fish`.
- Navigation and utilities: `cdlc.fish`, `cdlm.fish`, `fzfcd.fish`, `mntnas.fish`, `open.fish`, `killport.fish`, `disk_space.fish`.
- Time and workday helpers: `first_login_of_the_day.fish`, `set_workday_start.fish`, `remaining_work_hours.fish`, `workday_end.fish`, date parsing helpers.

## Helper Scripts

Fish wrappers call Bun helpers from `libexec/` with `bun --cwd ...`. Keep helper dependencies in `libexec/package.json` and `libexec/bun.lock`.

Biome config for helper scripts lives at `libexec/biome.json`.

## Notes

- Functions are autoloaded by Fish; avoid sourcing function files manually from `config.fish` unless startup order requires it.
- Some commands assume local tools such as `gum`, `fzf`, `fd`, `bun`, `opencode`, and `wt` are available from the system environment.
- Package installation belongs in the Nix system repo, not this dotfiles repo.
