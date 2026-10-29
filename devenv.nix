{ pkgs, lib, ... }:

let
  bunVersion = "1.4.0";
  bunSources = {
    "aarch64-darwin" = pkgs.fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-darwin-aarch64.zip";
      hash = "sha256-xmnpf2Fk4cluBwF0jbmN+ndJKQjL2DlMdVcTSnNd44E=";
    };
    "x86_64-darwin" = pkgs.fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-darwin-x64.zip";
      hash = "sha256-HQIRuPHcmRGCNEaHrRXnLuhvFUhFpff6R3mUzTQd2bA=";
    };
    "aarch64-linux" = pkgs.fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-linux-aarch64.zip";
      hash = "sha256-SxozLuhhmD65O8/m93D/+U4+MbLDiL2uo8jtNeWO7Q4=";
    };
    "x86_64-linux" = pkgs.fetchurl {
      url = "https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}/bun-linux-x64-baseline.zip";
      hash = "sha256-GE+0WV8NQBohfPfHjBvEMLqDMU2reouUgFurv3+nCX8=";
    };
  };
  # Remove the override once the rolling devenv package reaches Bun 1.4.
  projectBun =
    if lib.versionAtLeast pkgs.bun.version bunVersion then
      pkgs.bun
    else
      pkgs.bun.overrideAttrs (old: {
        version = bunVersion;
        src =
          bunSources.${pkgs.stdenvNoCC.hostPlatform.system}
            or (throw "Unsupported system: ${pkgs.stdenvNoCC.hostPlatform.system}");
        passthru = old.passthru // {
          sources = bunSources;
        };
      });
  hyprTests = ".config/hypr/tests";
  shellcheckGlobs = [
    "scripts/*.sh"
    ".config/ags/*.sh"
    ".config/ags/scripts/*.sh"
    ".config/ags/scripts/benchmark/**/*.sh"
    ".config/ags/components/**/__benchmarks__/*.sh"
    ".config/hypr/runtime/**/*.sh"
    ".config/hypr/legacy/scripts/*.sh"
    ".config/herdr/plugins/neovim-sessions/**/*.sh"
    ".config/vicinae/extensions/*.sh"
  ];
in

{
  packages = with pkgs; [
    act
    bash-language-server
    projectBun
    coreutils
    fish
    git
    gnused
    hyperfine
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
    nil
    nixd
    nodejs
    pnpm
    ripgrep
    ripsecrets
    shellcheck
    stow
    stylelint-lsp
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
        git config --local core.hooksPath .githooks
      '';
      status = ''
        test "$(git config --local --get core.hooksPath || true)" = ".githooks"
        test -x .githooks/pre-commit
      '';
    };

    "test:caliper-skill-eval".exec = ''
      set -euo pipefail
      python3 -m unittest discover -s tests -p 'caliper*test.py'
      cd .pi/agent
      bun run sdk:sync
      bun test evals/orchestration/__tests__
    '';
    "test:skill-suggestions-eval".exec = "python3 -m unittest discover -s .pi/agent/evals/skill-suggestions/__tests__ -p 'test_eval.py'";
    "test:writing-clearly".exec = ''
      set -euo pipefail
      python3 -m unittest discover -s tests -p 'test_writing_clearly_prose.py'
      python3 .agents/skills/writing-clearly/check-prose.py .agents/skills/writing-clearly/SKILL.md
    '';

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
      source_status_before="$(git status --porcelain --untracked-files=all)"

      bash ./scripts/secure-pi-agent-dir.sh "$target"
      mkdir -p "$target/.pi/agent/npm"
      printf '%s\n' target-runtime > "$target/.pi/agent/trust.json"
      printf '%s\n' target-runtime > "$target/.pi/agent/npm/package.json"
      stow --dir "$PWD" --target "$target" --restow .

      if [[ -L "$target/.pi" ]]; then
        printf '%s\n' 'Expected the Pi runtime root to remain a real directory' >&2
        exit 1
      fi
      if [[ "$(stat -c '%a' "$target/.pi/agent")" != 700 ]]; then
        printf '%s\n' 'Expected the deployed Pi agent directory to use mode 0700' >&2
        exit 1
      fi
      if [[ "$(<"$target/.pi/agent/trust.json")" != target-runtime ]] \
        || [[ "$(<"$target/.pi/agent/npm/package.json")" != target-runtime ]]; then
        printf '%s\n' 'Expected Stow to preserve existing Pi runtime state' >&2
        exit 1
      fi

      pi_runtime_paths=(
        ".pi/agent/.fallow"
        ".pi/agent/auth-profiles"
        ".pi/agent/auth.json"
        ".pi/agent/mcp-cache.json"
        ".pi/agent/models-store.json"
        ".pi/agent/sessions"
      )
      for deployment_path in "''${pi_runtime_paths[@]}"; do
        if test -e "$target/$deployment_path" || test -L "$target/$deployment_path"; then
          printf 'Pi runtime path was deployed: %s\n' "$deployment_path" >&2
          exit 1
        fi
      done

      required_paths=(
        ".config/ags/config-bundled.tsx"
        ".config/ags/scripts/generate-circular-avatar.sh"
        ".config/waybar/config"
        ".config/waybar/scripts/temperatures"
      )
      for deployment_path in "''${required_paths[@]}"; do
        if ! test -e "$target/$deployment_path"; then
          printf 'Expected Stow deployment is missing: %s\n' "$deployment_path" >&2
          exit 1
        fi
      done

      # Project-local Pi skills are intentionally discovered from the repository instead of deployed to ~/.pi.
      while IFS= read -r -d "" deployment_path; do
        case "$deployment_path" in
          ".pi/skills/"*) continue ;;
        esac
        if ! test -e "$target/$deployment_path"; then
          printf 'Expected Stow deployment is missing: %s\n' "$deployment_path" >&2
          exit 1
        fi
      done < <(git ls-files -z -- ".pi")

      while IFS= read -r -d "" deployment_path; do
        case "$deployment_path" in
          ".pi/agent/trust.json"|".pi/agent/npm/"*) continue ;;
        esac
        if test -e "$target/$deployment_path" || test -L "$target/$deployment_path"; then
          printf 'Git-ignored path was deployed: %s\n' "$deployment_path" >&2
          exit 1
        fi
      done < <(git ls-files --others --ignored --exclude-standard -z)

      ignored_paths=(
        "scripts"
        "docs"
        "design-system"
        "justfile"
        "lefthook.yml"
        ".codex"
        ".github"
        "tests"
      )
      for deployment_path in "''${ignored_paths[@]}"; do
        if test -e "$target/$deployment_path"; then
          printf 'Repository-only path was deployed: %s\n' "$deployment_path" >&2
          exit 1
        fi
      done

      stow --dir "$PWD" --target "$target" --restow .
      source_status_after="$(git status --porcelain --untracked-files=all)"
      if test "$source_status_before" != "$source_status_after"; then
        printf '%s\n' 'Normal Stow deployment modified the source working tree:' >&2
        git status --short >&2
        exit 1
      fi
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
      fish_output="$(env -u SSH_TTY -u SSH_CONNECTION -u DISPLAY -u WAYLAND_DISPLAY fish -c 'source .config/fish/config.fish' 2>&1)"
      if [[ -n "$fish_output" ]]; then
        printf '%s\n' "$fish_output" >&2
        exit 1
      fi
    '';

    "test:git-pull-system-repos".exec = ''
      set -euo pipefail
      fish tests/git_pull_system_repos.fish
    '';

    "test:fish-corporate-opencode".exec = "fish tests/fish_corporate_opencode.fish";


    "test:fish-ssh-agent".exec = "bun test ./.config/fish/libexec/__tests__/ssh_agent.test.js";

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

    "test:lua-quality:fbb".exec = "REQUIRE_LUA_TOOLS=1 bash scripts/lua-quality.sh fbb";
    "test:lua-quality:hyprland".exec = "REQUIRE_LUA_TOOLS=1 bash scripts/lua-quality.sh hyprland";
    "test:lua-quality:neovim".exec = "REQUIRE_LUA_TOOLS=1 bash scripts/lua-quality.sh neovim";
    "test:lua-quality:wezterm".exec = "REQUIRE_LUA_TOOLS=1 bash scripts/lua-quality.sh wezterm";
    "test:lua-quality:keybinds".exec = "REQUIRE_LUA_TOOLS=1 bash scripts/lua-quality.sh keybinds";
    "test:lua-quality" = {
      exec = "true";
      after = [
        "test:lua-quality:fbb"
        "test:lua-quality:hyprland"
        "test:lua-quality:neovim"
        "test:lua-quality:wezterm"
        "test:lua-quality:keybinds"
      ];
    };

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
        pnpm --dir .config/vicinae/extensions/home-assistant run test
        bun test ./.config/vicinae/extensions/hypr-quickrule/src/__tests__
        pnpm --dir .config/vicinae/extensions run build
      '';
    };

    "test:ags-gjs".exec = ''
      set -euo pipefail
      cd .config/ags
      timeout --foreground 180s bun run test:gjs
    '';

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
        timeout --foreground 60s bash "$test_file"
      done
    '';

    "test:herdr-neovim-sessions".exec = "bash .config/herdr/plugins/neovim-sessions/tests/restore.sh";

    "test:pi-browser".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test extensions/browser
      bun run typecheck
    '';

    "test:pi-agent-mentions".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test extensions/mentions extensions/prompt-ui/__tests__/autocomplete.test.ts extensions/prompt-ui/__tests__/autocomplete-dismissal.test.ts
    '';
    "test:pi-prompt-context".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun run typecheck
      bun test extensions/prompt-ui/__tests__/context-health.test.ts extensions/prompt-ui/__tests__/context-status.test.ts extensions/prompt-ui/__tests__/render-cache.test.ts extensions/prompt-ui/__tests__/index.test.ts
    '';
    "test:pi-subagents".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test extensions/subagents extensions/prompt-ui/__tests__/subagent-transcript-frame.test.ts
    '';
    "test:pi-subagent-budget-fixtures".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test benchmarks/__tests__/subagent-budget*.test.ts
      node_modules/.bin/tsc --project benchmarks/tsconfig.subagent-budgets.json
    '';
    "test:pi-diff-rendering".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test benchmarks/__tests__/diff-rendering.test.ts
      node_modules/.bin/tsc --project benchmarks/tsconfig.diff-rendering.json
    '';
    # Standalone selector; test:pi-context-baseline already includes this suite in test:all.
    "test:pi-context-masking".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun run typecheck
      bun test extensions/context-masking/__tests__
    '';
    "test:pi-context-baseline".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test benchmarks/__tests__/context-baseline.test.ts benchmarks/__tests__/context-masking-replay.test.ts benchmarks/__tests__/context-masking-recall-probe.test.ts benchmarks/__tests__/context-compaction.test.ts benchmarks/__tests__/context-pruning-recall.test.ts benchmarks/__tests__/context-compaction-tasks.test.ts benchmarks/__tests__/context-classifier-recall.test.ts benchmarks/__tests__/context-classifier-autonomous.test.ts benchmarks/__tests__/context-classifier-isolated.test.ts
      node_modules/.bin/tsc --project benchmarks/tsconfig.context-baseline.json
    '';

    "test:pi-context-masking-cadence".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test benchmarks/__tests__/context-masking-cadence.test.ts
      node_modules/.bin/tsc --project benchmarks/tsconfig.context-masking-cadence.json
    '';
    "test:pi-diff-rendering-extension".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test extensions/diff-rendering
      bun run typecheck
    '';
    "test:pi-extensions".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test extensions benchmarks lib evals/tool-call-guard
      bun run typecheck
    '';

    "test:pi-tool-call-guard".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test evals/tool-call-guard extensions/tool-call-guard extensions/classifier-policy/__tests__/index.test.ts
      bunx --no-install biome check extensions/tool-call-guard evals/tool-call-guard
      bun run typecheck
    '';

    "test:pi-mcp".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test __tests__/mcp.test.ts
      bunx --no-install biome check mcp.json __tests__
    '';

    "test:pi-prompt-cache".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test \
        extensions/__tests__/instruction-fragments.test.ts \
        extensions/__tests__/prompt-cache.test.ts \
        extensions/chart/__tests__/prompt.test.ts \
        extensions/mentions/__tests__
    '';

    "test:pi-tasks".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test extensions/tasks extensions/__tests__/instruction-fragments.test.ts
      bun run typecheck
    '';

    "test:pi-notices".exec = ''
      set -euo pipefail
      cd .pi/agent
      bun test \
        extensions/skill-discovery/__tests__/recommendation-chat.test.ts \
        extensions/tasks
      bun run typecheck
    '';

    "test:nvim-dekit-terminal".exec = ''
      set -euo pipefail
      REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE -i NONE \
        -l .config/nvim/tests/dekit_terminal.lua
    '';

    "test:nvim-diffnav-terminal".exec = ''
      REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE -i NONE \
        -l .config/nvim/tests/diffnav_terminal.lua
    '';

    "test:nvim-direnv-loader".exec = ''
      REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE \
        -l .config/nvim/tests/direnv_loader.lua
    '';

    "test:nvim-pi-direnv-launch".exec = ''
      REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE \
        --listen "$DEVENV_STATE/pi-direnv-launch.sock" -l .config/nvim/tests/pi_direnv_launch.lua
    '';

    "test:nvim-pi-launcher".exec = ''
      test_bin="$(mktemp -d "$DEVENV_STATE/pi-launcher-bin.XXXXXX")"
      trap 'rm -rf "$test_bin"' EXIT
      printf '%s\n' '#!/bin/sh' 'exit 127' > "$test_bin/pi"
      chmod +x "$test_bin/pi"
      PATH="$test_bin:$PATH" REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE \
        --listen "$DEVENV_STATE/pi-launcher.sock" -l .config/nvim/tests/pi_launcher.lua
    '';

    "test:nvim-pi-cutover".exec = ''
      REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE \
        -l .config/nvim/tests/pi_cutover.lua
    '';

    "test:nvim-pi-prompt".exec = ''
      REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE \
        -l .config/nvim/tests/pi_prompt.lua
    '';

    "test:nvim-pi-session-restore".exec = ''
      REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE --listen "$DEVENV_STATE/pi-session-restore.sock" \
        -l .config/nvim/tests/pi_session_restore.lua
    '';


    "test:nvim-session-selection".exec = ''
      set -euo pipefail
      test_config="$(mktemp -d "$DEVENV_STATE/nvim-session-selection.XXXXXX")"
      trap 'rm -rf "$test_config"' EXIT
      XDG_CONFIG_HOME="$test_config" REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE \
        -l .config/nvim/tests/session_selection.lua
    '';
    "test:nvim-pi-production-restore".exec =
      "timeout --foreground 15s bash .config/herdr/plugins/neovim-sessions/tests/pi_restore_order.sh";

    "test:nvim-pack-inventory".exec = ''
      XDG_CONFIG_HOME="$PWD/.config" REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE \
        -l .config/nvim/tests/pack_inventory.lua
    '';

    "test:nvim-statusline-git-cache".exec = ''
      REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE -i NONE \
        -l .config/nvim/tests/statusline_git_cache.lua
    '';

    "test:nvim-pack-loader".exec = ''
      REPO_ROOT="$PWD" timeout --foreground 15s nvim --headless -u NONE \
        -l .config/nvim/tests/pack_loader.lua
    '';

    "test:nvim-pack-lazy-startup".exec = ''
      # Keep copied config outside paths excluded by wildignore; Darwin also canonicalizes /tmp.
      if [[ "$(uname -s)" == "Darwin" ]]; then
        temp_parent="$(getconf DARWIN_USER_TEMP_DIR)"
      else
        temp_parent="$DEVENV_STATE"
      fi
      test_root="$(mktemp -d "''${temp_parent%/}/nvim-pack-lazy.XXXXXX")"
      trap 'rm -rf "$test_root"' EXIT
      live_data_root="''${XDG_DATA_HOME:-$HOME/.local/share}/nvim"
      mkdir -p "$test_root/config/nvim" "$test_root/data/nvim" "$test_root/cache"
      cp -R "$PWD/.config/fbb" "$test_root/config/fbb"
      cp -R "$PWD/.config/nvim/lua" "$test_root/config/nvim/lua"
      cp "$PWD/.config/nvim/init.lua" "$test_root/config/nvim/init.lua"
      cp "$PWD/.config/nvim/nvim-pack-lock.json" "$test_root/config/nvim/nvim-pack-lock.json"
      env -u GIT_EDITOR -u GIT_COMMIT -u NVIM_SESSION -u HERDR_ENV -u HERDR_PANE_ID -u NVIM_APPNAME \
        XDG_CONFIG_HOME="$test_root/config" XDG_DATA_HOME="$test_root/data" \
        XDG_STATE_HOME="$test_root/state" XDG_CACHE_HOME="$test_root/cache" \
        PACK_LAZY_PLUGIN_SITE="$live_data_root/site" REPO_ROOT="$PWD" \
        timeout --foreground 15s nvim --headless -i NONE \
        --cmd "lua dofile('$PWD/.config/nvim/tests/pack_lazy_startup.lua')"
      for initial_file in "$PWD/.config/nvim/tests/pack_loader.lua" "$test_root/new.lua"; do
        rm -rf "$test_root/config/nvim/.sessions"
        env -u GIT_EDITOR -u GIT_COMMIT -u NVIM_SESSION -u HERDR_ENV -u HERDR_PANE_ID -u NVIM_APPNAME \
          XDG_CONFIG_HOME="$test_root/config" XDG_DATA_HOME="$test_root/data" \
          XDG_STATE_HOME="$test_root/state" XDG_CACHE_HOME="$test_root/cache" \
          PACK_LAZY_PLUGIN_SITE="$live_data_root/site" PACK_LAZY_INITIAL_FILE=1 REPO_ROOT="$PWD" \
          timeout --foreground 15s nvim --headless -i NONE \
          --cmd "lua dofile('$PWD/.config/nvim/tests/pack_lazy_startup.lua')" "$initial_file"
      done
    '';

    "test:waybar-css".exec = "bash scripts/validate-waybar-css.sh";

    "test:lua".exec = ''
      set -euo pipefail
      timeout --foreground 15s busted --lua=luajit ${hyprTests}
    '';

    "test:hypr-runtime".exec = ''
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
        "test:caliper-skill-eval"
        "test:skill-suggestions-eval"
        "test:stow"
        "test:fish"
        "test:git-pull-system-repos"
        "test:fish-ssh-agent"
        "test:fish-starship-cache"
        "test:herdr-neovim-sessions"
        "test:lua-quality"
        "test:pi-extensions"
        "test:pi-diff-rendering"
        "test:pi-context-baseline"
        "test:pi-context-masking-cadence"
        "test:pi-mcp"
        "test:nvim-dekit-terminal"
        "test:nvim-diffnav-terminal"
        "test:nvim-direnv-loader"
        "test:nvim-pi-direnv-launch"
        "test:nvim-pi-launcher"
        "test:nvim-pi-cutover"
        "test:nvim-pi-prompt"
        "test:nvim-pi-session-restore"
        "test:nvim-session-selection"
        "test:nvim-pi-production-restore"
        "test:nvim-pack-lazy-startup"
        "test:nvim-statusline-git-cache"
        "test:nvim-pack-loader"
        "test:nvim-pack-inventory"
        "test:vicinae"
        "test:runtime-shell"
        "test:ags-gjs"
        "test:lua"
        "test:hypr-runtime"
      ];
    };
  };

  enterTest = ''
    bun run --cwd .pi/agent sdk:sync
    devenv tasks run test:all
  '';
}
