# Common Operations

## Setup & Installation

```bash
brew bundle install              # Install/update all dependencies
stow .                           # Apply dotfiles (creates symlinks from ~/)
stow -n .                        # Dry-run to preview changes
bash ./scripts/install.sh        # Fresh system setup (installs everything)
```

## Adoption Migration

Normal Stow deployment, including Home Manager activation, never uses `--adopt`. To intentionally migrate existing local files into this Git repository, start from a clean working tree and run:

```bash
just stow-adopt                 # Dry-runs first, then adopts files
```

## Configuration Lifecycle

On a fresh NixOS or nix-darwin machine, Home Manager clones the flake-pinned bootstrap revision into `~/dotfiles`, Stows it into `$HOME`, and leaves that checkout mutable. On non-Nix systems, clone `~/dotfiles` and run `stow .` directly.

For ordinary dotfile development, edit `~/dotfiles`; the deployed symlinks reflect changes immediately, so no Nix rebuild is required. Keep the deployed checkout on `master` as the canonical configuration source. Create a separate Git worktree or Worktrunk checkout for feature development.

Use `git_pull_system_repos` to reconcile `~/nixos` and the deployed `~/dotfiles` checkout. It requires both working trees to be clean, fast-forward pulls both repositories, aligns a non-master dotfiles checkout only after confirmation (or `--yes` non-interactively), then restows and installs dependencies/plugins. A Nix rebuild is separate from ordinary dotfile editing and repository synchronization: Nix provides declarative machine bootstrap, while `~/dotfiles` remains mutable, portable user configuration.

## Neovim

```bash
nvim --headless -i NONE '+qa'      # Install locked native plugins
nvim --headless +checkhealth +qa   # Validate setup
```

## Vicinae Extensions

```bash
./scripts/vicinae-build-extensions.sh  # Build all extensions
# See .config/vicinae/extensions/AGENTS.md for extension development guide
```

## Testing Changes

```bash
fish -c "source ~/.config/fish/config.fish"  # Test fish config
bat cache --build                            # Rebuild bat cache after theme changes
stow -n .                                    # Preview stow changes before applying
```
