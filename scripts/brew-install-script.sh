#!/bin/bash

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

fish
fish_add_path /opt/homebrew/bin
echo "opt/homebrew/bin/fish" | sudo tee -a /etc/shells
chsh -s opt/homebrew/bin/fish
