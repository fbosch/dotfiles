{ pkgs, ... }:

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

  enterTest = ''
    bash .config/hypr/tests/runtime/run.sh
  '';
}
