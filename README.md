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

## Deployment And Adoption

Normal deployment creates or refreshes symlinks and never adopts files into the repository. Home Manager runs this normal deployment during system activation.

```sh
just stow-apply
just stow-restow
```

Adoption is a one-time migration for existing local files. Run it only intentionally with a clean Git working tree; `just stow-adopt` previews the changes, then may move managed target files into the repository before it applies them.

```sh
just stow-adopt
```

## Dependencies

All system packages and dependencies are declaratively managed in my NixOS configuration:

**→ [github.com/fbosch/nixos](https://github.com/fbosch/nixos)**

This dotfiles repository contains only the application configuration files.
