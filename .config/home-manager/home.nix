{ pkgs, ... }: {
  home.username = "fbb";
  home.homeDirectory = "/home/fbb";
  programs.home-manager.enable = true;
  home.stateVersion = "24.11";
  home.packages = with pkgs; [
    # system
    stow
    cmake
    coreutils

    # files
    fzf
    lf
    bat
    fd
    eza
    ripgrep
    zoxide
    cloc
    grc

    # terminal
    starship
    fish
    wezterm
    btop

    # development 
    git
    lazygit
    delta
    neovim
    bun
    nodejs
    fnm
    jq
    rustc
  ];
}
