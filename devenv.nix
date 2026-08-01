{ pkgs, ... }:

let
  hyprTests = ".config/hypr/tests";
in

{
  packages = with pkgs; [
    bun
    coreutils
    fish
    git
    gnused
    jq
    just
    lua
    luajit_2_1
    luajitPackages.busted
    luajitPackages.luasocket
    markdownlint-cli
    neovim
    nodejs
    pnpm
    ripgrep
    shellcheck
    stow
    stylua
    yq-go
  ];

  tasks = {
    "test:runtime-shell".exec = ''
      set -euo pipefail
      shopt -s nullglob
      test_files=(${hyprTests}/runtime/*.sh)
      if (( ''${#test_files[@]} == 0 )); then
        printf '%s\n' "No runtime shell tests found" >&2
        exit 1
      fi
      bash -n "''${test_files[@]}"
      shellcheck "''${test_files[@]}"
      for test_file in "''${test_files[@]}"; do
        timeout --foreground 15s bash "$test_file"
      done
    '';

    "test:lua".exec = ''
      set -euo pipefail
      timeout --foreground 15s busted --lua=luajit ${hyprTests}
    '';

    "test:window-state-runtime".exec = ''
      set -euo pipefail
      shopt -s nullglob
      test_files=(${hyprTests}/runtime/*_runtime.lua)
      if (( ''${#test_files[@]} == 0 )); then
        printf '%s\n' "No runtime Lua tests found" >&2
        exit 1
      fi
      for test_file in "''${test_files[@]}"; do
        REPO_ROOT="$PWD" timeout --foreground 15s luajit "$test_file"
      done
    '';

    "test:all" = {
      exec = "true";
      after = [
        "test:runtime-shell"
        "test:lua"
        "test:window-state-runtime"
      ];
      before = [ "devenv:enterTest" ];
    };
  };
}
