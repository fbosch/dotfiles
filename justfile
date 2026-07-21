# Run recipes in devenv when the current shell has not already activated it.
set shell := ["bash", "-eu", "-o", "pipefail", "-c", "[ -n \"${DEVENV_ROOT:-}\" ] || exec devenv shell -- bash -eu -o pipefail -c \"$0\"; exec bash -eu -o pipefail -c \"$0\""]

default:
	@just --list

# Install OpenCode dependencies.
install-opencode:
	pnpm install --dir .config/opencode

# Validate the project devenv environment.
devenv-test:
	devenv test

# Run Storybook for the design system.
storybook:
	pnpm --dir design-system storybook

# Build Storybook for the design system.
build-storybook:
	pnpm --dir design-system build-storybook

# Install dependencies for OpenCode plugins.
install-opencode-plugins:
	bun install --cwd .config/opencode/plugins

# Restart user daemons used by the desktop setup asynchronously.
restart-daemons:
	nohup bash .config/hypr/runtime/desktop/restart-daemons.sh >/dev/null 2>&1 &

# Show Hyprland daemon status and matching process IDs.
daemon-status:
	#!/usr/bin/env bash
	set -euo pipefail
	daemons=(
	  "Window state|[w]indow-state-daemon.lua"
	  "Window capture|[w]indow-capture-daemon.lua"
	  "Custom layout|[c]ustom-layout-drag-resize-daemon.lua"
	  "Minimized state|[m]inimized-state-daemon.lua"
	  "Gaming watchdog|[g]aming-session-watchdog"
	)
	running="$(CLICOLOR_FORCE=1 gum style --foreground 10 "running")"
	stopped="$(CLICOLOR_FORCE=1 gum style --foreground 9 "stopped")"
	rows=()
	for daemon in "${daemons[@]}"; do
	  name="${daemon%%|*}"
	  pattern="${daemon#*|}"
	  pids="$(pgrep -f "$pattern" | paste -sd " " - || true)"
	  if [ -n "$pids" ]; then
	    rows+=("$name,$running,$pids")
	  else
	    rows+=("$name,$stopped,-")
	  fi
	done
	gum style --bold --foreground 212 "Hyprland Daemons"
	printf "%s\n" "${rows[@]}" | gum table --print --columns "Daemon,Status,PIDs" --border rounded --padding "0 1"

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
	git ls-files -z -- '*.sh' ':(exclude).config/hypr/tests/**' | xargs -0 shellcheck

# Build Vicinae extensions.
vicinae-build:
	bash ./scripts/vicinae-build-extensions.sh

# Run a Vicinae extension dev server.
vicinae-dev extension:
	pnpm --dir .config/vicinae/extensions/{{extension}} run dev

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
