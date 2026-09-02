# Run recipes in devenv when the current shell has not already activated it.
set shell := ["bash", "-eu", "-o", "pipefail", "-c", "[ -n \"${DEVENV_ROOT:-}\" ] || exec devenv shell -- bash -eu -o pipefail -c \"$0\"; exec bash -eu -o pipefail -c \"$0\""]

# List available recipes.
default:
    @just --list

# Bundle the AGS configuration to a runtime artifact.
[group('ags')]
ags-bundle:
    bun run --cwd .config/ags bundle

# Rebuild and restart the bundled AGS daemon.
[group('ags')]
ags-refresh: ags-bundle
    ags quit --instance ags-bundled
    uwsm-app -s s -- "$HOME/.config/ags/start-daemons.sh"

# Regenerate AGS type definitions.
[group('ags')]
ags-types:
    bash -lc 'cd .config/ags && ags types'

# Install dependencies for shared FBB helpers.
[group('dependencies')]
install-fbb:
    bun install --frozen-lockfile --cwd .config/fbb

# Install dependencies for Fish Bun helpers.
[group('dependencies')]
install-fish-libexec:
    bun install --frozen-lockfile --cwd .config/fish/libexec

# Install AGS dependencies and build its initial runtime bundle.
[group('dependencies')]
install-ags: _install-ags-dependencies ags-bundle

_install-ags-dependencies:
    bun install --frozen-lockfile --cwd .config/ags

# Install all managed dependencies and build first-use artifacts.
[group('dependencies')]
install-all: install-ags install-fbb install-fish-libexec install-opencode install-opencode-plugins install-pi install-vicinae

# Install OpenCode dependencies.
[group('dependencies')]
install-opencode:
    pnpm install --dir .config/opencode

# Install dependencies for OpenCode plugins.
[group('dependencies')]
install-opencode-plugins:
    bun install --frozen-lockfile --cwd .config/opencode/plugins

# Install Pi extension dependencies.
[group('dependencies')]
install-pi:
    bun install --frozen-lockfile --cwd "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

# Install dependencies and build all Vicinae extensions for first use.
[group('dependencies')]
install-vicinae: vicinae-build

# Show Hyprland daemon status and matching process IDs.
[group('desktop')]
daemon-status:
    #!/usr/bin/env bash
    set -euo pipefail
    daemons=(
      "Window state|[w]indow-state-daemon.lua"
      "Window capture|[w]indow-capture-daemon.lua"
      "Picture in picture|[p]icture-in-picture.lua"
      "Waybar monitor|[w]aybar-monitor.lua"
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

# Generate Fish shell caches.
[group('desktop')]
fish-cache:
    bash ./scripts/fish-generate-caches.sh

# Validate Glance YAML configuration.
[group('desktop')]
glance-validate:
    bash .config/glance/scripts/validate-yaml.sh

# Validate Hyprland config on Linux.
[group('desktop')]
hypr-validate:
    bash -lc 'if [ "$(uname)" = "Linux" ]; then hyprctl configerrors; fi'

# Restart allowlisted daemons, or all desktop daemons when none are specified.
[group('desktop')]
[positional-arguments]
restart-daemons *daemons:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ "$#" -eq 0 ]]; then
      nohup bash .config/hypr/runtime/desktop/restart-daemons.sh >/dev/null 2>&1 &
      exit 0
    fi
    bash .config/hypr/runtime/desktop/restart-daemons.sh "$@"

# Build Storybook for the design system.
[group('development')]
build-storybook:
    pnpm --dir design-system build-storybook

# Record Bun benchmarks or opt-in profiles. Target: runtime, install, profiles, all.
[group('development')]
bun-benchmark $target="runtime":
    bash scripts/benchmark-bun.sh "$target"

# Run Storybook for the design system.
[group('development')]
storybook:
    pnpm --dir design-system storybook

# Sync docs cache metadata.
[group('development')]
update-docs:
    pnpx docs-cache@latest sync

# Report whether disabled Neovim packages remain installed.
[group('nvim')]
nvim-check-disabled-packages:
    @XDG_CONFIG_HOME="$PWD/.config" nvim --headless -u NONE -i NONE \
      '+lua require("config.pack.report").run()' \
      '+qa'

# Apply stow operations.
[group('stow')]
stow-apply:
    bash ./scripts/secure-pi-agent-dir.sh
    stow .

# Migrate existing files into this repository after previewing a clean working tree.
[group('stow')]
stow-adopt:
    bash ./scripts/stow-adopt.sh

# Check stow operations without changing files.
[group('stow')]
stow-check:
    stow -n .

# Restow dotfiles.
[group('stow')]
stow-restow:
    bash ./scripts/secure-pi-agent-dir.sh
    stow -R .

# Validate the project devenv environment.
[group('validation')]
devenv-test:
    devenv test

# Check Fish scripts for syntax errors.
[group('validation')]
fish-syntax:
    bash -lc 'shopt -s globstar nullglob; fish -n .config/fish/**/*.fish'

# Run Lua diagnostics and config tests. Mode: baseline, changed, staged, ci.
[group('validation')]
lua-quality $mode="baseline":
    bash scripts/lua-quality.sh "$mode"

# Report Lua formatting drift without writing files. Scope: changed, staged, all.
[group('validation')]
lua-style $scope="changed":
    bash scripts/lua-quality.sh "style-$scope"

# Run shellcheck on shell scripts.
[group('validation')]
shellcheck:
    git ls-files -z -- '*.sh' ':(exclude).config/hypr/tests/**' | xargs -0 shellcheck

# Run core local validation checks.
[group('validation')]
validate-core: stow-check
    fish -c "source ~/.config/fish/config.fish"
    nvim --headless +checkhealth +qa

# Check runtime and declared keybindings for overlapping input combinations.
[group('validation')]
validate-keybinds:
    bun scripts/validate-keybinds.ts

# Build Vicinae extensions.
[group('vicinae')]
vicinae-build:
    bash ./scripts/vicinae-build-extensions.sh

# Run a Vicinae extension dev server.
[group('vicinae')]
vicinae-dev $extension:
    pnpm --dir ".config/vicinae/extensions/$extension" run dev

# Lint Vicinae extensions.
[group('vicinae')]
vicinae-lint:
    bash -lc 'cd .config/vicinae/extensions && pnpm exec vici lint'
