#!/usr/bin/env bash
# Build all Vicinae extensions using pnpm workspace
# This script installs dependencies and builds all extensions in .config/vicinae/extensions/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(dirname "$SCRIPT_DIR")"
EXTENSIONS_DIR="$DOTFILES_ROOT/.config/vicinae/extensions"

echo "🔍 Building Vicinae extensions with pnpm workspace..."
echo "Extensions directory: $EXTENSIONS_DIR"
echo ""

if [ ! -d "$EXTENSIONS_DIR" ]; then
  echo "❌ Extensions directory not found: $EXTENSIONS_DIR"
  exit 1
fi

# Change to extensions directory
cd "$EXTENSIONS_DIR"

# Install dependencies for workspace
echo "📦 Installing workspace dependencies..."
if pnpm install; then
  echo "✓ Dependencies installed"
  echo ""
else
  echo "✗ Failed to install dependencies"
  exit 1
fi

# Build all extensions
echo "🔨 Building all extensions..."
if pnpm -r build; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "✅ All extensions built successfully!"
else
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "❌ Build failed"
  exit 1
fi
