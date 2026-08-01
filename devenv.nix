{ pkgs, lib, ... }:

let
  hyprTests = ".config/hypr/tests";
  shellcheckGlobs = [
    "scripts/*.sh"
    ".config/ags/*.sh"
    ".config/ags/scripts/*.sh"
    ".config/hypr/runtime/**/*.sh"
    ".config/hypr/legacy/scripts/*.sh"
    ".config/vicinae/extensions/*.sh"
  ];
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
    lefthook
    lua
    luajit_2_1
    luajitPackages.busted
    luajitPackages.luasocket
    lua-language-server
    markdownlint-cli
    neovim
    nodejs
    pnpm
    ripgrep
    ripsecrets
    shellcheck
    stow
    stylua
    yq-go
  ];

  tasks = {
    "hooks:install" = {
      exec = ''
        set -euo pipefail
        if [[ "''${CI:-}" == "true" ]]; then
          exit 0
        fi
        lefthook install
      '';
      before = [ "devenv:enterShell" ];
    };

    "test:shellcheck".exec = ''
      set -euo pipefail
      shopt -s globstar nullglob
      test_files=(${lib.concatStringsSep " " shellcheckGlobs})
      if (( ''${#test_files[@]} == 0 )); then
        printf '%s\n' "No shellcheck targets found" >&2
        exit 1
      fi
      shellcheck "''${test_files[@]}"
    '';

    "test:stow".exec = ''
      set -euo pipefail
      stow -n .
    '';

    "test:fish".exec = ''
      set -euo pipefail
      shopt -s globstar nullglob
      test_files=(.config/fish/**/*.fish)
      if (( ''${#test_files[@]} == 0 )); then
        printf '%s\n' "No Fish files found" >&2
        exit 1
      fi
      fish -n "''${test_files[@]}"
    '';

    "test:lua-quality".exec = ''
      set -euo pipefail
      REQUIRE_LUA_TOOLS=1 bash scripts/lua-quality.sh ci
    '';

    "test:design-system".exec = ''
      set -euo pipefail
      pnpm --dir design-system install --frozen-lockfile
      pnpm --dir design-system lint
      pnpm --dir design-system contrast
    '';

    "test:vicinae-install".exec = ''
      set -euo pipefail
      pnpm --dir .config/vicinae/extensions install --frozen-lockfile
    '';

    "test:vicinae" = {
      after = [ "test:vicinae-install" ];
      exec = ''
      set -euo pipefail
      pnpm --dir .config/vicinae/extensions run lint
      pnpm --dir .config/vicinae/extensions run build
      '';
    };

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
        "test:shellcheck"
        "test:stow"
        "test:fish"
        "test:lua-quality"
        "test:vicinae"
        "test:runtime-shell"
        "test:lua"
        "test:window-state-runtime"
      ];
      before = [ "devenv:enterTest" ];
    };
  };
}
