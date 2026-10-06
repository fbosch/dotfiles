#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DEVENV_STATE:?Run this setup through devenv test}"
: "${XDG_DATA_HOME:?The test runner must supply an isolated data directory}"
if [[ "$XDG_DATA_HOME" != "$DEVENV_STATE/test-data" ]]; then
  printf '%s\n' 'Refusing to install test plugins outside the devenv test data directory' >&2
  exit 1
fi
cd "$repo_root"

# Finish dependency writes before parallel tests snapshot the Stow source tree.
for workspace in .config/ags .config/fbb .config/fish/libexec .pi/agent; do
  bun install --frozen-lockfile --cwd "$workspace"
done

# Integration tests exercise the reviewed package patches, not a live Pi profile.
package_specs="$(bun --no-install -e '
  import { discoverPackagePatches } from "./.pi/agent/lib/patch-catalog.ts";
  for (const { name, version } of discoverPackagePatches(".pi/agent/patches")) {
    console.log(name + "@" + version);
  }
')"
if [[ -z "$package_specs" ]]; then
  printf '%s\n' 'No reviewed Pi package fixtures found' >&2
  exit 1
fi
mapfile -t packages <<<"$package_specs"
npm install --prefix .pi/agent/npm --ignore-scripts --no-audit --no-fund --save-exact "${packages[@]}"
bun --no-install .pi/agent/lib/pi-npm.ts --apply-patches .pi/agent/npm

# Lens and Subagents declare incompatible peer ranges. Resolve the viewer's own
# dependency graph separately instead of suppressing npm's peer validation.
subagent_spec="$(jq -er '.packages[] | select(test("^npm:@gotgenes/pi-subagents@[0-9]+\\.[0-9]+\\.[0-9]+$")) | ltrimstr("npm:")' .pi/agent/settings.json)"
subagent_root="$repo_root/.pi/agent/npm/.test-fixtures/subagents"
npm install --prefix "$subagent_root" --ignore-scripts --no-audit --no-fund --save-exact "$subagent_spec"
subagent_link="$repo_root/.pi/agent/npm/node_modules/@gotgenes/pi-subagents"
mkdir -p "$(dirname "$subagent_link")"
if [[ -e "$subagent_link" && ! -L "$subagent_link" ]]; then
  printf 'Refusing to replace an existing Subagents installation: %s\n' "$subagent_link" >&2
  exit 1
fi
ln -sfn "$subagent_root/node_modules/@gotgenes/pi-subagents" "$subagent_link"

# Read the existing lock without running Neovim's interactive package updater.
# Never depend on, or update, plugins installed in the developer's actual home.
plugin_site="$XDG_DATA_HOME/nvim/site/pack/core/opt"
mkdir -p "$plugin_site"
plugin_specs="$(jq -er '.plugins | to_entries[] | [.key, .value.src, .value.rev] | @tsv' .config/nvim/nvim-pack-lock.json)"
while IFS=$'\t' read -r name source revision; do
  if [[ ! "$name" =~ ^[[:alnum:]_.-]+$ || ! "$revision" =~ ^[[:xdigit:]]{40}$ ]]; then
    printf 'Invalid locked Neovim plugin: %s\n' "$name" >&2
    exit 1
  fi
  destination="$plugin_site/$name"
  if [[ -L "$destination" ]]; then
    printf 'Refusing to modify a linked plugin fixture: %s\n' "$destination" >&2
    exit 1
  fi
  if [[ "$(git -C "$destination" rev-parse HEAD 2>/dev/null || true)" == "$revision" ]]; then
    continue
  fi
  git init --quiet "$destination"
  git -C "$destination" fetch --quiet --depth=1 "$source" "$revision"
  git -C "$destination" -c advice.detachedHead=false checkout --quiet --detach FETCH_HEAD
done <<<"$plugin_specs"
