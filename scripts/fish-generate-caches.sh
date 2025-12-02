#!/usr/bin/env bash
# Generate Fish shell cache files for improved startup performance

set -e

FISH_CONF_D="$HOME/.config/fish/conf.d"

echo "Generating Fish shell cache files..."

# Create conf.d directory if it doesn't exist
mkdir -p "$FISH_CONF_D"

# Generate zoxide cache if zoxide is installed
if command -v zoxide >/dev/null 2>&1; then
    echo "  ✓ Generating zoxide cache..."
    zoxide init fish > "$FISH_CONF_D/zoxide_cache.fish"
else
    echo "  ✗ zoxide not found, skipping"
fi

# Generate starship cache if starship is installed
if command -v starship >/dev/null 2>&1; then
    echo "  ✓ Generating starship cache..."
    starship init fish --print-full-init > "$FISH_CONF_D/starship_cache.fish"
else
    echo "  ✗ starship not found, skipping"
fi

echo ""
echo "Cache generation complete!"
echo "Note: conf.d/ is gitignored. Run this script after fresh installs."
