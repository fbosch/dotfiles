#!/bin/bash

# Check the operating system
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  echo "Installing on macOS..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  # Linux
  echo "Installing on Linux..."
  sudo apt install build-essential
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "Unsupported operating system."
  exit 1
fi
