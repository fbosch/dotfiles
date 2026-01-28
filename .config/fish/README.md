# Fish Configuration

Fish shell configuration with extensive functions, aliases, and environment setup.

**Root configuration files (sourced by config.fish):**

- `config.fish` - Main entry point (OS detection, Hyprland launcher, function autoloading)
- `aliases.fish` - Abbreviations and command aliases (neovim, pnpm, brew, directory shortcuts)
- `profile.fish` - Environment variables (TERM, EDITOR, PATH, FZF options, XDG paths)
- `scripts.fish` - Miscellaneous utilities (copy_output, etc.)
- `coreutils.fish` - uutils-coreutils replacements
- `gum.fish` - Gum CLI wrapper functions
- `colors.fish` - Color theme and utilities
- `private.fish` - Local/private settings (not in repo)

**Functions (autoloaded):

_AI/OpenCode integration:_

- `ai_commit.fish` - OpenCode AI commit message generation
- `ai_pr.fish` - OpenCode AI PR description generation

_Git worktree management:_

- `worktree_add.fish`, `worktrees_clean.fish`, `latest_worktree.fish`
- `git_add_gum.fish` - Interactive git add with gum

_Directory navigation:_

- `cdlc.fish`, `cdlm.fish`, `fzfcd.fish` - Custom cd variants
- `mntnas.fish` - Mount NAS

_Work/time tracking:_

- `first_login_of_the_day.fish`, `set_workday_start.fish`, `remaining_work_hours.fish`, `workday_end.fish`
- `get_week_dates.fish`, `parse_flexible_date.fish`, `format_date_display.fish`
- `__time_ago_from_timestamp.fish` - Time calculation helper

_Azure DevOps integration:_

- `workitems_on_date.fish`, `workitems_week.fish`, `workitems_cache_clear.fish`
- `__workitems_extract.fish` - Helper for parsing work items
- `ado_test_case.fish` - Azure DevOps test case helpers

_Nix/flake management:_

- `flake_check_updates.fish`, `flake_update_interactive.fish`, `flake_updates_daemon.fish`
- `flake_update_cache_metadata.fish` - Cache metadata updates
- `nxrb.fish` - Nix rebuild shortcut

_System utilities:_

- `proxy_status.fish`, `toggle_proxy.fish`, `mullvad_random_socks5.fish` - Network/VPN
- `disk_space.fish`, `killport.fish`, `hyprprop_kill.fish` - System utilities
- `progress_bar.fish` - Progress bar utilities

_Package management:_

- `export_npm_globals.fish`, `install_npm_globals.fish` - NPM global management
- `pnpx.fish` - pnpm exec wrapper

_General utilities:_

- `colors.fish` - Color helpers
- `open.fish` - Open command wrapper
- `copykey.fish` - Copy SSH key to clipboard
- `wezterm_set_user_var.fish` - Wezterm integration
- `gum.fish` - Gum CLI wrappers
- `src.fish` - Source config reload

**Notes:**

- Functions are autoloaded from `functions/` directory
- Managed via Nix/Home Manager as part of dotfiles
- Uses gum for interactive prompts and colored output
- FZF configured for fd-based file finding with threading
- Environment variables cached to avoid repeated external commands on startup
