#!/usr/bin/env dash

set -eu

if [ "$#" -ge 2 ] && [ "$1" = "flatpak" ] && [ "$2" = "run" ]; then
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
				exec uwsm-app -s a -- "$1.desktop"
				;;
		esac
	done
fi

exec uwsm-app -s a -- "$@"
