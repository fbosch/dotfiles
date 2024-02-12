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

  curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher
else 
  echo "Updating homebrew..."
  brew update
fi


brew bundle install