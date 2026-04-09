install-opencode-plugins:
	bun install --cwd .config/opencode/plugins

restart-daemons:
	bash .config/hypr/scripts/restart-daemons.sh

update-docs:
	pnpx docs-cache@latest sync

validate-core:
	stow -n .
	fish -c "source ~/.config/fish/config.fish"
	nvim --headless +checkhealth +qa

fish-syntax:
	bash -lc 'shopt -s globstar nullglob; fish -n .config/fish/**/*.fish'

shellcheck:
	shellcheck scripts/*.sh .config/ags/*.sh .config/ags/scripts/*.sh .config/hypr/scripts/*.sh .config/rofi/launchers/type-3/launcher.sh .config/vicinae/extensions/*.sh

vicinae-build:
	bash ./scripts/vicinae-build-extensions.sh

vicinae-lint:
	bash -lc 'cd .config/vicinae/extensions && pnpm exec vici lint'

hypr-validate:
	bash -lc 'if [ "$(uname)" = "Linux" ]; then hyprctl configerrors; fi'

ags-types:
	bash -lc 'cd .config/ags && ags types'

glance-validate:
	bash .config/glance/scripts/validate-yaml.sh
