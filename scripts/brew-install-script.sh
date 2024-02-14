#!/bin/bash

if [[ $(command -v brew) == "" ]]; then
  echo "Installing homebrew..."
  os_name=$(uname -s)
  case $os_name in
      "Darwin")
          /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
          ;;
      "Linux")
          /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
          test -d ~/.linuxbrew && eval "(~/.linuxbrew/bin/brew shellenv)"
          test -d /home/linuxbrew/.linuxbrew && eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
          echo "eval \"\$($(brew --prefix)/bin/brew shellenv)\"" >> ~/.bashrc
          ;;
      *)
          echo "Unknown or unsupported operating system"
          ;;
  esac
  
  brew bundle install
  corepack enable pnpm
  corepack enable yarn
  npm i -g swpm

  curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher
  
  tempfile=$(mktemp)
  curl -o $tempfile https://raw.githubusercontent.com/wez/wezterm/master/termwiz/data/wezterm.terminfo
  tic -x -o ~/.terminfo $tempfile 
  rm $tempfile

else 
  echo "Updating homebrew..."
  brew update
fi


brew bundle install
