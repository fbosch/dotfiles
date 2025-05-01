#!/bin/bash

if [[ $(command -v brew) == "" ]]; then
  echo "Installing homebrew..."
  os_name=$(uname -s)
  case $os_name in
      "Darwin")
          # install homebrew
          /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" 
          # install rust
          curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
          ;;
      "Linux")
          # install homebrew
          /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
          test -d ~/.linuxbrew && eval "(~/.linuxbrew/bin/brew shellenv)"
          test -d /home/linuxbrew/.linuxbrew && eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
          echo "eval \"\$($(brew --prefix)/bin/brew shellenv)\"" >> ~/.bashrc
          # install rust
          curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
          ;;
      *)
          echo "Unknown or unsupported operating system"
          ;;
  esac
  
  # installs brew bundle
  brew bundle install

  # install pnpm & yarn
  corepack enable pnpm
  corepack enable yarn

  # install swpm
  npm i -g swpm

  # install fisher
  curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher
  
  # set wezterm terminfo
  tempfile=$(mktemp)
  curl -o $tempfile https://raw.githubusercontent.com/wez/wezterm/master/termwiz/data/wezterm.terminfo
  tic -x -o ~/.terminfo $tempfile 
  rm $tempfile

  chsh -s $(which fish)
  bat cache --build
else 
  echo "Updating homebrew..."
  brew update
fi


brew bundle install
