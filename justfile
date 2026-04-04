install-opencode-plugins:
	bun install --cwd .config/opencode/plugins

restart-daemons:
	bash .config/hypr/scripts/restart-daemons.sh
