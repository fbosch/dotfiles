# Common Operations

## Setup & Installation

```bash
brew bundle install              # Install/update all dependencies
stow .                           # Apply dotfiles (creates symlinks from ~/)
stow -n .                        # Dry-run to preview changes
bash ./scripts/install.sh        # Fresh system setup (installs everything)
```

## Neovim

```bash
nvim --headless +"Lazy! sync" +qa  # Update plugins
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
