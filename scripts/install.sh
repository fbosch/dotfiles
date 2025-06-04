#!/bin/bash

if [[ $(command -v brew) == "" ]]; then
  echo "Installing homebrew..."
  os_name=$(uname -s)
  case $os_name in
      "Darwin")
          # install homebrew
          /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" 
          eval "$(/opt/homebrew/bin/brew shellenv || /usr/local/bin/brew shellenv)"
          ;;
      "Linux")
          # install homebrew
          /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
          test -d ~/.linuxbrew && eval "(~/.linuxbrew/bin/brew shellenv)"
          test -d /home/linuxbrew/.linuxbrew && eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
          echo "eval \"\$($(brew --prefix)/bin/brew shellenv)\"" >> ~/.bashrc
          ;;
      *)
          echo "Unknown or unsupported operating system"
          ;;
  esac
  
  # install rust
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

  # installs brew bundle
  brew bundle install

  # install pnpm & yarn
  corepack enable pnpm
  corepack enable yarn

  # install swpm
  npm i -g swpm
  npm i -g neovim

  # install fisher
  curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher
  
  # set wezterm terminfo
  tempfile=$(mktemp)
  curl -o $tempfile https://raw.githubusercontent.com/wez/wezterm/master/termwiz/data/wezterm.terminfo
  tic -x -o ~/.terminfo $tempfile 
  rm $tempfile

  chsh -s $(which fish) # set fish as default shell
  bat cache --build # build the bat cache for colorscheme to work
  stow . # stow the dotfiles
else 
  echo "Updating homebrew..."
  brew bundle install
  brew update
  fish -c "install_npm_globals"
  bat cache --build
fi
