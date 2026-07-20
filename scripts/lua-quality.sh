#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

quote_command() {
  local quoted=""
  printf -v quoted "%q " "$@"
  printf "%s" "$quoted"
}

run_tool() {
  local cmd="$1"
  local pkg="$2"
  shift 2

  if command -v "$cmd" >/dev/null 2>&1; then
    "$cmd" "$@"
    return
  fi

  if command -v nix-shell >/dev/null 2>&1; then
    nix-shell -p "$pkg" --run "$(quote_command "$cmd" "$@")"
    return
  fi

  if [[ "${REQUIRE_LUA_TOOLS:-0}" == "1" ]]; then
    echo "lua-quality: $cmd not found and nix-shell unavailable" >&2
    return 127
  fi

  echo "lua-quality: $cmd not found, skipping" >&2
}

is_lua_file() {
  local file="$1"
  [[ "$file" == *.lua && -f "$file" ]]
}

collect_staged_lua_files() {
  local file
  while IFS= read -r file; do
    is_lua_file "$file" && printf "%s\n" "$file"
  done < <(git diff --cached --name-only --diff-filter=ACM)
}

collect_changed_lua_files() {
  local file
  local before="${GITHUB_EVENT_BEFORE:-}"

  if [[ -z "${GITHUB_ACTIONS:-}" ]]; then
    git diff --name-only --diff-filter=ACM HEAD
  elif [[ -n "${GITHUB_BASE_REF:-}" ]]; then
    git diff --name-only --diff-filter=ACM "origin/${GITHUB_BASE_REF}...HEAD"
  elif [[ -n "$before" && ! "$before" =~ ^0+$ ]]; then
    git diff --name-only --diff-filter=ACM "$before...HEAD" || git diff --name-only --diff-filter=ACM "HEAD~1...HEAD"
  else
    git diff --name-only --diff-filter=ACM "HEAD~1...HEAD" || git ls-files
  fi | while IFS= read -r file; do
    is_lua_file "$file" && printf "%s\n" "$file"
  done
}

run_stylua_check() {
  local -a files=("$@")
  if [[ ${#files[@]} -eq 0 ]]; then
    echo "lua-quality: no Lua files for StyLua"
    return 0
  fi

  echo "lua-quality: stylua --check ${files[*]}"
  run_tool stylua stylua --check --output-format=summary --syntax LuaJit --respect-ignores "${files[@]}"
}

run_luals_check() {
  echo "lua-quality: lua-language-server error check"
  run_tool lua-language-server lua-language-server --check="$ROOT" --checklevel=Error --check_format=pretty
}

run_lua_tests() {
  echo "lua-quality: Lua config tests"
  run_tool lua lua5_2 .config/wezterm/tests/status_workhours_spec.lua
  run_tool lua lua5_2 .config/wezterm/tests/agent_deck_detection_spec.lua
  run_tool lua lua5_2 .config/hypr/tests/bind.lua
  run_tool luac lua5_2 -p .config/hypr/hyprland.lua
}

run_baseline() {
  run_luals_check
  run_lua_tests
}

mode="${1:-baseline}"
case "$mode" in
  baseline)
    run_baseline
    ;;
  style-staged)
    mapfile -t lua_files < <(collect_staged_lua_files)
    run_stylua_check "${lua_files[@]}"
    ;;
  staged)
    run_baseline
    ;;
  changed | ci)
    run_baseline
    ;;
  style-changed)
    mapfile -t lua_files < <(collect_changed_lua_files)
    run_stylua_check "${lua_files[@]}"
    ;;
  style-all)
    run_stylua_check .config/wezterm .config/nvim/lua .config/hypr
    ;;
  *)
    echo "usage: $0 [baseline|staged|changed|ci|style-staged|style-changed|style-all]" >&2
    exit 2
    ;;
esac
