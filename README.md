# 🗂️ Dotfiles

Config files and scripts for my development environment.  
Managed with [GNU Stow](https://www.gnu.org/software/stow/) for easy symlink management.

## Installation

```sh
# navigate to home directory
cd ~

# clone the repository
git clone git@github.com:fbosch/dotfiles.git

# navigate to the directory
cd dotfiles

# initiate GNU Stow to create symlinks
stow .
```

## Dependencies

All system packages and dependencies are declaratively managed in my NixOS configuration:

**→ [github.com/fbosch/nixos](https://github.com/fbosch/nixos)**

This dotfiles repository contains only the application configuration files.
