set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
dev := "devenv shell --"

default:
	@just --list

# Install OpenCode dependencies.
install-opencode:
	{{dev}} pnpm install --dir .config/opencode

# Validate the project devenv environment.
devenv-test:
	devenv test

# Run Storybook for the design system.
storybook:
	{{dev}} pnpm --dir design-system storybook

# Build Storybook for the design system.
build-storybook:
	{{dev}} pnpm --dir design-system build-storybook

# Install dependencies for OpenCode plugins.
install-opencode-plugins:
	{{dev}} bun install --cwd .config/opencode/plugins

# Restart user daemons used by the desktop setup asynchronously.
restart-daemons:
	nohup bash .config/hypr/runtime/desktop/restart-daemons.sh >/dev/null 2>&1 &

# Sync docs cache metadata.
update-docs:
	{{dev}} pnpx docs-cache@latest sync

# Run core local validation checks.
validate-core:
	stow -n .
	{{dev}} fish -c "source ~/.config/fish/config.fish"
	{{dev}} nvim --headless +checkhealth +qa

# Run Lua diagnostics and config tests. Mode: baseline, changed, staged, ci.
lua-quality mode="baseline":
	{{dev}} bash scripts/lua-quality.sh {{mode}}

# Report Lua formatting drift without writing files. Scope: changed, staged, all.
lua-style scope="changed":
	{{dev}} bash scripts/lua-quality.sh style-{{scope}}

# Check Fish scripts for syntax errors.
fish-syntax:
	{{dev}} bash -lc 'shopt -s globstar nullglob; fish -n .config/fish/**/*.fish'

# Run shellcheck on shell scripts.
shellcheck:
	{{dev}} shellcheck scripts/*.sh .config/ags/*.sh .config/ags/scripts/*.sh .config/hypr/scripts/*.sh .config/rofi/launchers/type-3/launcher.sh .config/vicinae/extensions/*.sh

# Build Vicinae extensions.
vicinae-build:
	{{dev}} bash ./scripts/vicinae-build-extensions.sh

# Run a Vicinae extension dev server.
vicinae-dev extension:
	{{dev}} pnpm --dir .config/vicinae/extensions/{{extension}} run dev

# Lint Vicinae extensions.
vicinae-lint:
	{{dev}} bash -lc 'cd .config/vicinae/extensions && pnpm exec vici lint'

# Validate Hyprland config on Linux.
hypr-validate:
	{{dev}} bash -lc 'if [ "$(uname)" = "Linux" ]; then hyprctl configerrors; fi'

# Regenerate AGS type definitions.
ags-types:
	{{dev}} bash -lc 'cd .config/ags && ags types'

# Validate Glance YAML configuration.
glance-validate:
	{{dev}} bash .config/glance/scripts/validate-yaml.sh

# Generate Fish shell caches.
fish-cache:
	{{dev}} bash ./scripts/fish-generate-caches.sh

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
