# Install OpenCode dependencies.
install-opencode:
	pnpm install --dir .config/opencode

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

# Check Fish scripts for syntax errors.
fish-syntax:
	bash -lc 'shopt -s globstar nullglob; fish -n .config/fish/**/*.fish'

# Run shellcheck on shell scripts.
shellcheck:
	shellcheck scripts/*.sh .config/ags/*.sh .config/ags/scripts/*.sh .config/hypr/scripts/*.sh .config/rofi/launchers/type-3/launcher.sh .config/vicinae/extensions/*.sh

# Build Vicinae extensions.
vicinae-build:
	bash ./scripts/vicinae-build-extensions.sh

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
