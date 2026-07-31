{ pkgs, ... }:

{
  packages = with pkgs; [
    bun
    fish
    git
    gnused
    jq
    just
    lua
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
}
