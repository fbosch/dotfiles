set shell := ["bash", "-eu", "-o", "pipefail", "-c", "[ -n \"${DEVENV_ROOT:-}\" ] || exec devenv shell -- bash -eu -o pipefail -c \"$0\"; exec bash -eu -o pipefail -c \"$0\""]

default:
	@just --list

# Install OpenCode dependencies.
install-opencode:
	pnpm install --dir .config/opencode

# Enter the project devenv shell.
devenv-shell:
	devenv shell

# Validate the project devenv environment.
devenv-test:
	devenv test

# Run Storybook for the design system.
storybook:
	pnpm --dir design-system storybook

# Build Storybook for the design system.
storybook-build:
	pnpm --dir design-system build-storybook

# Build Storybook for the design system.
build-storybook: storybook-build

# Install dependencies for OpenCode plugins.
install-opencode-plugins:
	bun install --cwd .config/opencode/plugins

# Restart user daemons used by the desktop setup.
restart-daemons:
	bash .config/hypr/scripts/restart-daemons.sh

# Sync docs cache metadata.
update-docs:
	pnpx docs-cache@latest sync

# Run core local validation checks.
validate-core:
	stow -n .
	fish -c "source ~/.config/fish/config.fish"
	nvim --headless +checkhealth +qa

# Run Lua diagnostics and config tests. Mode: baseline, changed, staged, ci.
lua-quality mode="baseline":
	bash scripts/lua-quality.sh {{mode}}

# Report Lua formatting drift without writing files. Scope: changed, staged, all.
lua-style scope="changed":
	bash scripts/lua-quality.sh style-{{scope}}

# Check Fish scripts for syntax errors.
fish-syntax:
	bash -lc 'shopt -s globstar nullglob; fish -n .config/fish/**/*.fish'

# Run shellcheck on shell scripts.
shellcheck:
	shellcheck scripts/*.sh .config/ags/*.sh .config/ags/scripts/*.sh .config/hypr/scripts/*.sh .config/rofi/launchers/type-3/launcher.sh .config/vicinae/extensions/*.sh

# Build Vicinae extensions.
vicinae-build:
	bash ./scripts/vicinae-build-extensions.sh

# Run a Vicinae extension dev server.
vicinae-dev extension:
	pnpm --dir .config/vicinae/extensions/{{extension}} run dev

# Run favorite-directories Vicinae extension dev server.
vicinae-favorite-directories:
	just vicinae-dev favorite-directories

# Run flathub-search Vicinae extension dev server.
vicinae-flathub-search:
	just vicinae-dev flathub-search

# Run local-wallpaper Vicinae extension dev server.
vicinae-local-wallpaper:
	just vicinae-dev local-wallpaper

# Run nerdfont-search Vicinae extension dev server.
vicinae-nerdfont-search:
	just vicinae-dev nerdfont-search

# Run protondb-search Vicinae extension dev server.
vicinae-protondb-search:
	just vicinae-dev protondb-search

# Run wallhaven-search Vicinae extension dev server.
vicinae-wallhaven-search:
	just vicinae-dev wallhaven-search

# Run hyprprop Vicinae extension dev server.
vicinae-hyprprop:
	just vicinae-dev hyprprop

# Run kagi-search Vicinae extension dev server.
vicinae-kagi-search:
	just vicinae-dev kagi-search

# Run sysinfo Vicinae extension dev server.
vicinae-sysinfo:
	just vicinae-dev sysinfo

# Run color-tools Vicinae extension dev server.
vicinae-color-tools:
	just vicinae-dev color-tools

# Run hypr-quickrule Vicinae extension dev server.
vicinae-hypr-quickrule:
	just vicinae-dev hypr-quickrule

# Run clamav-scanner Vicinae extension dev server.
vicinae-clamav-scanner:
	just vicinae-dev clamav-scanner

# Lint Vicinae extensions.
vicinae-lint:
	bash -lc 'cd .config/vicinae/extensions && pnpm exec vici lint'

# Validate Hyprland config on Linux.
hypr-validate:
	bash -lc 'if [ "$(uname)" = "Linux" ]; then hyprctl configerrors; fi'

# Regenerate AGS type definitions.
ags-types:
	bash -lc 'cd .config/ags && ags types'

# Validate Glance YAML configuration.
glance-validate:
	bash .config/glance/scripts/validate-yaml.sh

# Generate Fish shell caches.
fish-cache:
	bash ./scripts/fish-generate-caches.sh

# Install Homebrew bundle dependencies.
brew-install:
	brew bundle install

# Check Homebrew bundle dependencies.
brew-check:
	brew bundle check

# Check stow operations without changing files.
stow-check:
	stow -n .

# Apply stow operations.
stow-apply:
	stow .

# Restow dotfiles.
stow-restow:
	stow -R .
