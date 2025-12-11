#!/usr/bin/env bash
# Build all Vicinae extensions
# This script installs dependencies and builds all extensions in .config/vicinae/extensions/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(dirname "$SCRIPT_DIR")"
EXTENSIONS_DIR="$DOTFILES_ROOT/.config/vicinae/extensions"

echo "🔍 Building Vicinae extensions..."
echo "Extensions directory: $EXTENSIONS_DIR"
echo ""

if [ ! -d "$EXTENSIONS_DIR" ]; then
  echo "❌ Extensions directory not found: $EXTENSIONS_DIR"
  exit 1
fi

# Find all directories with package.json
extension_count=0
failed_extensions=()

for ext_dir in "$EXTENSIONS_DIR"/*/; do
  if [ -f "$ext_dir/package.json" ]; then
    ext_name=$(basename "$ext_dir")
    extension_count=$((extension_count + 1))
    
    echo "📦 [$extension_count] Building: $ext_name"
    echo "   Directory: $ext_dir"
    
    # Install dependencies
    echo "   → Installing dependencies..."
    if (cd "$ext_dir" && npm install --silent); then
      echo "   ✓ Dependencies installed"
    else
      echo "   ✗ Failed to install dependencies"
      failed_extensions+=("$ext_name (install)")
      continue
    fi
    
    # Build extension
    echo "   → Building extension..."
    if (cd "$ext_dir" && npm run build); then
      echo "   ✓ Build successful"
    else
      echo "   ✗ Build failed"
      failed_extensions+=("$ext_name (build)")
    fi
    
    echo ""
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ ${#failed_extensions[@]} -eq 0 ]; then
  echo "✅ All $extension_count extensions built successfully!"
else
  echo "⚠️  Built with errors:"
  echo "   Total extensions: $extension_count"
  echo "   Failed: ${#failed_extensions[@]}"
  echo ""
  echo "Failed extensions:"
  for ext in "${failed_extensions[@]}"; do
    echo "   • $ext"
  done
  exit 1
fi
