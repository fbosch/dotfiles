#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
agent_root="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
lock_package="$agent_root/node_modules/proper-lockfile"
lock_target="$lock_package/lib/mtime-precision.js"
lock_patch="$repo_root/.pi/agent/runtime-patches/proper-lockfile-4.1.2.patch"
patch_manifest="$repo_root/.pi/agent/patches/targets.tsv"

for lock_directory in "$lock_package" "$lock_package/lib"; do
  if [[ -L "$lock_directory" ]]; then
    printf 'Refusing symlinked proper-lockfile path %s\n' "$lock_directory" >&2
    exit 1
  fi
  if [[ ! -d "$lock_directory" ]]; then
    printf 'proper-lockfile directory is missing: %s\n' "$lock_directory" >&2
    exit 1
  fi
done

if [[ ! -f "$lock_target" ]]; then
  printf 'proper-lockfile target is missing from %s\n' "$agent_root" >&2
  exit 1
fi
if [[ ! -f "$lock_patch" || ! -f "$patch_manifest" ]]; then
  printf 'proper-lockfile patch or target manifest is missing\n' >&2
  exit 1
fi

if ! hashes="$(awk -F '\t' '
  $1 == "runtime" && $2 == "proper-lockfile" && $3 == "proper-lockfile-4.1.2.patch" && $4 == "lib/mtime-precision.js" {
    print $5 "\t" $6
    count++
  }
  END { if (count != 1) exit 1 }
' "$patch_manifest")"; then
  printf 'Expected exactly one proper-lockfile target entry in %s\n' "$patch_manifest" >&2
  exit 1
fi
IFS=$'\t' read -r preimage postimage <<<"$hashes"
if [[ ! "$preimage" =~ ^([a-f0-9]{64}|-)$ || ! "$postimage" =~ ^([a-f0-9]{64}|-)$ || "$preimage" == "$postimage" ]]; then
  printf 'Invalid proper-lockfile target hashes in %s\n' "$patch_manifest" >&2
  exit 1
fi

actual=absent
if [[ -L "$lock_target" ]]; then
  printf 'Refusing symlinked proper-lockfile target %s\n' "$lock_target" >&2
  exit 1
elif [[ -e "$lock_target" ]]; then
  if [[ ! -f "$lock_target" ]]; then
    printf 'proper-lockfile target is not a regular file: %s\n' "$lock_target" >&2
    exit 1
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$lock_target" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$lock_target" | awk '{print $1}')"
  else
    printf 'Need sha256sum or shasum to verify Pi patch targets\n' >&2
    exit 1
  fi
fi

if [[ "$actual" == "$postimage" ]]; then
  exit 0
fi
if [[ "$actual" != "$preimage" ]]; then
  printf 'Refusing to patch proper-lockfile: target content does not match a reviewed preimage or postimage\n' >&2
  exit 1
fi

# Hash validation is stricter than patch context matching; retain zero-fuzz dry-run as a final guard.
patch --batch --fuzz=0 --dry-run -d "$agent_root" -p1 <"$lock_patch"
patch --batch --fuzz=0 -d "$agent_root" -p1 <"$lock_patch"
actual="$(sha256sum "$lock_target" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$lock_target" | awk '{print $1}')"
if [[ "$actual" != "$postimage" ]]; then
  printf 'proper-lockfile patch produced an unexpected target hash\n' >&2
  exit 1
fi
