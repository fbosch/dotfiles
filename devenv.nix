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
    util-linux
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
      target="$(mktemp -d)"
      trap 'rm -rf "$target"' EXIT

      # Prevent directory folding from masking nested ignore behavior.
      mkdir -p "$target/.config/ags" "$target/.config/waybar"
      stow --dir "$PWD" --target "$target" .

      required_paths=(
        ".config/ags/config-bundled.tsx"
        ".config/ags/scripts/generate-circular-avatar.sh"
        ".config/waybar/config"
        ".config/waybar/scripts/temperatures"
      )
      for deployment_path in "''${required_paths[@]}"; do
        test -e "$target/$deployment_path"
      done

      ignored_paths=(
        "scripts"
        "docs"
        "design-system"
        "justfile"
        "lefthook.yml"
        ".codex"
      )
      for deployment_path in "''${ignored_paths[@]}"; do
        test ! -e "$target/$deployment_path"
      done

      stow --dir "$PWD" --target "$target" .
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

    "test:fish-starship-cache".exec = ''
      set -euo pipefail
      test_dir="$(mktemp -d)"
      trap 'rm -rf "$test_dir"' EXIT

      for version in a b; do
        mkdir -p "$test_dir/$version"
        cat > "$test_dir/$version/starship" <<'EOF'
      #!/usr/bin/env bash
      version="$(basename "$(dirname "$0")")"
      printf 'set -g starship_cache_fixture %s\n' "$version"
      EOF
        chmod +x "$test_dir/$version/starship"
      done

      run_fish() {
        HOME="$test_dir/home" \
          XDG_CONFIG_HOME="$test_dir/home/.config" \
          PATH="$test_dir/$1:$PATH" \
          FISH_CONFIG="$PWD/.config/fish/config.fish" \
          fish -ic 'source "$FISH_CONFIG"' >/dev/null
      }

      run_fish a
      test "$(<"$test_dir/home/.cache/fish/starship-init.fish.path")" = "$test_dir/a/starship"

      run_fish b
      test "$(<"$test_dir/home/.cache/fish/starship-init.fish.path")" = "$test_dir/b/starship"
      grep -Fq 'starship_cache_fixture b' "$test_dir/home/.cache/fish/starship-init.fish"
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
        timeout --foreground 30s bash "$test_file"
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
        "test:fish-starship-cache"
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
