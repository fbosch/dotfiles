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
