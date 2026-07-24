#!/usr/bin/env bash
set -euo pipefail

command="${1:?command is required}"
start_dir="${2:-$PWD}"

project_root() {
	local dir="$start_dir"
	while [[ "$dir" != "/" ]]; do
		if [[ -e "$dir/package.json" || -e "$dir/.git" || -e "$dir/Cargo.toml" || -e "$dir/justfile" || -e "$dir/Justfile" || -e "$dir/.justfile" || -e "$dir/.bare" ]]; then
			printf '%s\n' "$dir"
			return
		fi
		dir="$(dirname "$dir")"
	done
	printf '%s\n' "$start_dir"
}

uses_npm() {
	local dir="$start_dir"
	while [[ "$dir" != "/" ]]; do
		if [[ -e "$dir/tsconfig.json" ]]; then
			return 0
		fi
		if [[ -f "$dir/package.json" ]] && jq -e '(.dependencies // {} | has("typescript") or has("react")) or (.devDependencies // {} | has("typescript") or has("react"))' "$dir/package.json" >/dev/null; then
			return 0
		fi
		dir="$(dirname "$dir")"
	done
	return 1
}

run_mprocs() {
	local root config
	local -a args=()
	root="$(project_root)"
	config=""
	if [[ -f "$root/mprocs.yaml" ]]; then
		config="$root/mprocs.yaml"
	elif [[ -f "$root/mprocs.yml" ]]; then
		config="$root/mprocs.yml"
	fi
	if [[ -n "$config" ]]; then
		args+=(--config "$config")
	fi
	if [[ -f "$root/justfile" || -f "$root/Justfile" || -f "$root/.justfile" ]]; then
		args+=(--just)
	elif uses_npm; then
		args+=(--npm)
	fi
	cd "$root"
	if [[ -f "$root/.envrc" ]]; then
		exec direnv exec "$root" mprocs "${args[@]}"
	fi
	exec mprocs "${args[@]}"
}

case "$command" in
	root)
		project_root
		;;
	todo)
		root="$(project_root)"
		for file in todo.md .todo.md TODO.md; do
			if [[ -f "$root/$file" ]]; then
				printf '%s\n' "$root/$file"
				exit 0
			fi
		done
		exit 1
		;;
	mprocs)
		run_mprocs
		;;
	*)
		printf 'Unknown project command: %s\n' "$command" >&2
		exit 2
		;;
esac
