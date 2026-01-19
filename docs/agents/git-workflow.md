# Git Workflow and Validation

## Validation Checklist

Before committing config changes:

1. [ ] Run `stow -n .` to preview symlink changes
2. [ ] Test Neovim: `nvim --headless +checkhealth +qa`
3. [ ] Test Fish: `fish -c "source ~/.config/fish/config.fish"`
4. [ ] Verify no auto-generated files are staged: `git status`
5. [ ] Check `.gitignore` patterns match
