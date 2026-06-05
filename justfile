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
