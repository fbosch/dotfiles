{ pkgs, ... }: {
  home.username = "fbb";
  home.homeDirectory = "/Users/fbb";
  programs.home-manager.enable = true;
  home.packages = {
    pkgs.stow
  }
}
