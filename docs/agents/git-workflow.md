# Git Workflow and Validation

## Validation Checklist

Before committing config changes:

1. [ ] Run `just stow-check` to preview symlink changes
2. [ ] If files under `.config/nvim/` changed, test Neovim: `nvim --headless +checkhealth +qa`
3. [ ] If files under `.config/fish/` changed, test Fish: `fish -c "source ~/.config/fish/config.fish"`
4. [ ] Verify no auto-generated files are staged: `git status`
5. [ ] Check `.gitignore` patterns match

Run the Neovim and Fish checks only for their affected scopes. Unrelated documentation, Hyprland, or other config changes do not require those checks.

## PR Iteration Gates

Before non-trivial git or PR actions (new branch base, update existing PR vs create new PR, or follow-up push strategy), confirm:

1. [ ] Branch/PR target matches current user intent
2. [ ] Existing PR can be updated instead of creating a new PR (unless user asked otherwise)
3. [ ] Required validation scope for this iteration is clear

## Review Comment State

When fixing PR feedback:

1. [ ] Push the code fix
2. [ ] Resolve or mark the related review comment/thread state immediately after push
3. [ ] Keep thread state aligned with reality (`done/resolved` when addressed, `outdated` when no action remains)
