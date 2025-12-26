#!/usr/bin/env bash
# Fetch GitHub avatar for hyprlock
# Usage: ./fetch-github-avatar.sh [username]

GITHUB_USER="${1:-fbosch}"
AVATAR_PATH="$HOME/.cache/hyprlock-avatar.png"
TEMP_PATH="$HOME/.cache/hyprlock-avatar-temp.png"

# Create cache directory if it doesn't exist
mkdir -p "$HOME/.cache"

# Fetch avatar URL from GitHub API
AVATAR_URL=$(curl -s "https://api.github.com/users/$GITHUB_USER" | grep -o '"avatar_url": "[^"]*"' | cut -d'"' -f4)

if [ -z "$AVATAR_URL" ]; then
    echo "Error: Could not fetch avatar URL for user: $GITHUB_USER"
    exit 1
fi

# Download the avatar
if curl -s -o "$TEMP_PATH" "$AVATAR_URL"; then
    mv "$TEMP_PATH" "$AVATAR_PATH"
    echo "Avatar downloaded successfully to $AVATAR_PATH"
    exit 0
else
    echo "Error: Failed to download avatar"
    exit 1
fi
