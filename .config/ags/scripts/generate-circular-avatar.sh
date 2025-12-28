#!/usr/bin/env bash
# Generate circular avatar from .face file for AGS start menu

FACE_FILE="$HOME/.face"
CACHE_DIR="$HOME/.cache"
SIZE=28

# Check if .face exists
if [[ ! -f "$FACE_FILE" ]]; then
    echo "Error: $FACE_FILE not found"
    exit 1
fi

# Calculate hash of .face file
CURRENT_HASH=$(sha256sum "$FACE_FILE" | cut -d' ' -f1)
OUTPUT_FILE="$CACHE_DIR/ags-avatar-${CURRENT_HASH}.png"

# Check if avatar with this hash already exists
if [[ -f "$OUTPUT_FILE" ]]; then
    # Already exists, nothing to do
    exit 0
fi

# Clean up old avatar files
rm -f "$CACHE_DIR"/ags-avatar-*.png

# Use ImageMagick to create circular avatar
magick "$FACE_FILE" \
    -resize "${SIZE}x${SIZE}^" \
    -gravity center \
    -extent "${SIZE}x${SIZE}" \
    \( +clone -threshold -1 -negate -fill white -draw "circle $((SIZE/2)),$((SIZE/2)) $((SIZE/2)),0" \) \
    -alpha off -compose copy_opacity -composite \
    "$OUTPUT_FILE"

echo "Circular avatar generated at $OUTPUT_FILE"
