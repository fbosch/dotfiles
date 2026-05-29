#!/usr/bin/env dash

set -eu

flatpak_app_id() {
	shift 2

	while [ "$#" -gt 0 ]; do
		case "$1" in
			--)
				shift
				break
				;;
			--*=*)
				shift
				;;
			--branch|--arch|--command|--cwd|--env|--filesystem|--socket|--device|--talk-name|--own-name)
				shift 2
				;;
			-*)
				shift
				;;
			*)
				printf '%s\n' "$1"
				return 0
				;;
		esac
	done

	[ "$#" -gt 0 ] && printf '%s\n' "$1"
}

kill_stale_flatpak_instances() {
	app_id="$1"

	flatpak ps --columns=instance,pid,application | while read -r instance pid application; do
		if [ "$pid" = "0" ] && [ "$application" = "$app_id" ]; then
			flatpak kill "$instance" 2>/dev/null || true
		fi
	done
}

if [ "$#" -ge 2 ] && [ "$1" = "flatpak" ] && [ "$2" = "run" ]; then
	app_id="$(flatpak_app_id "$@")"
	[ -n "$app_id" ] && kill_stale_flatpak_instances "$app_id"

	"$@" &
	pid="$!"
	sleep 2
	[ -n "$app_id" ] && kill_stale_flatpak_instances "$app_id"
	wait "$pid" 2>/dev/null || true
	exit 0
fi

exec uwsm-app -s a -- "$@"
