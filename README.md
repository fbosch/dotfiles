# 🗂️ Dotfiles

Configuration and supporting tools for my macOS and Linux development environments.

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

Linux system packages and dependencies are declaratively managed in my NixOS configuration:

**→ [github.com/fbosch/nixos](https://github.com/fbosch/nixos)**

This repository contains application configuration plus the scripts, extensions, plugins, tests, and benchmarks that support it. Some configuration, including Hyprland and AGS, is Linux-specific.
