#!/usr/bin/env bash
# Opt-in only: this may cause comma/Nix to download or build a package.
set -euo pipefail

command_name=${1:?usage: smoke-real-comma.sh <known-bare-command> [arguments...]}
shift
case "$command_name" in
  ""|*/*)
    printf '%s\n' 'smoke: command must be a bare executable name' >&2
    exit 2
    ;;
esac
if command -v -- "$command_name" >/dev/null; then
  printf '%s\n' 'smoke: choose a command absent from PATH so Bash attempts recovery' >&2
  exit 2
fi
command -v comma >/dev/null || {
  printf '%s\n' 'smoke: comma is not on PATH' >&2
  exit 2
}
command -v bun >/dev/null || {
  printf '%s\n' 'smoke: bun is required to load the TypeScript extension' >&2
  exit 2
}

extension_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
setup=$(cd -- "$extension_dir" && PI_COMMA_PATH="$(command -v comma)" \
  PI_COMMA_PICKER="$extension_dir/ambiguous-picker.sh" bun -e '
    import { createSetupFragment } from "./index.ts";
    process.stdout.write(createSetupFragment({
      commaPath: process.env.PI_COMMA_PATH!,
      pickerPath: process.env.PI_COMMA_PICKER!,
    }));
  ')

printf 'smoke: resolving %s through comma; this may download or build software\n' "$command_name" >&2
bash -c "$setup"$'\n''"$@"' pi-comma-smoke "$command_name" "$@"
