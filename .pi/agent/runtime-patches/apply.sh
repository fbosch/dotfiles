#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
agent_root="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

lock_package="$agent_root/node_modules/proper-lockfile"
lock_manifest="$lock_package/package.json"
lock_target="$lock_package/lib/mtime-precision.js"
lock_patch="$repo_root/.pi/agent/runtime-patches/proper-lockfile-4.1.2.patch"

if [[ ! -f "$lock_manifest" || ! -f "$lock_target" ]]; then
  printf 'proper-lockfile@4.1.2 is missing from %s\n' "$agent_root" >&2
  exit 1
fi

if ! grep -q '"version"[[:space:]]*:[[:space:]]*"4\.1\.2"' "$lock_manifest"; then
  printf 'Refusing to patch an unsupported proper-lockfile version in %s\n' "$lock_manifest" >&2
  exit 1
fi

# WeakMap avoids mutating Bun's Proxy-backed fs object while retaining the precision cache.
if ! grep -q 'const precisionCache = new WeakMap();' "$lock_target"; then
  if ! grep -q 'const cacheSymbol = Symbol();' "$lock_target"; then
    printf 'proper-lockfile has an unexpected mtime-precision implementation\n' >&2
    exit 1
  fi
  patch --batch --fuzz=0 -d "$agent_root" -p1 <"$lock_patch"
fi
