#!/usr/bin/env bash
# svg-to-png.sh - Convert SVG icons to PNG with transparent backgrounds
#
# Usage:
#   ./svg-to-png.sh [extension-name] [size]
#
# Arguments:
#   extension-name  - Name of the extension directory (optional, converts all if omitted)
#   size           - PNG output size in pixels (default: 512)
#
# Examples:
#   ./svg-to-png.sh                    # Convert all extensions with SVG icons
#   ./svg-to-png.sh color-tools        # Convert only color-tools extension
#   ./svg-to-png.sh hyprprop 1024      # Convert hyprprop with 1024x1024 output

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIZE="${2:-512}"  # Default to 512x512 for Vicinae requirements

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
    echo -e "${GREEN}✓${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $*"
}

log_error() {
    echo -e "${RED}✗${NC} $*" >&2
}

# Check for rsvg-convert
check_dependencies() {
    if ! command -v rsvg-convert >/dev/null 2>&1; then
        log_error "rsvg-convert not found!"
        log_error "Please install librsvg: nix-env -iA nixpkgs.librsvg"
        exit 1
    fi
}

# Convert SVG to PNG using rsvg-convert
convert_svg() {
    local svg_file="$1"
    local png_file="$2"
    local size="$3"
    
    rsvg-convert \
        --width="$size" \
        --height="$size" \
        --keep-aspect-ratio \
        --format=png \
        --output="$png_file" \
        "$svg_file"
}

# Process a single extension
process_extension() {
    local ext_dir="$1"
    local ext_name
    ext_name="$(basename "$ext_dir")"
    local svg_file="$ext_dir/assets/extension_icon.svg"
    local png_file="$ext_dir/assets/extension_icon.png"
    
    # Check if SVG exists
    if [[ ! -f "$svg_file" ]]; then
        log_warning "Skipping $ext_name: No SVG icon found"
        return 0
    fi
    
    log_info "Processing $ext_name..."
    
    # Backup existing PNG if it exists and is different from what we'll create
    if [[ -f "$png_file" ]]; then
        log_info "  Backing up existing PNG to extension_icon.png.bak"
        cp "$png_file" "$png_file.bak"
    fi
    
    # Convert SVG to PNG
    if convert_svg "$svg_file" "$png_file" "$SIZE"; then
        log_success "  Created ${SIZE}x${SIZE} PNG icon"
        
        # Verify the output
        if [[ -f "$png_file" ]]; then
            local file_size
            file_size=$(stat -c%s "$png_file" 2>/dev/null || stat -f%z "$png_file" 2>/dev/null)
            if [[ $file_size -gt 0 ]]; then
                log_success "Successfully converted $ext_name (${file_size} bytes)"
            else
                log_error "  Generated PNG is empty for $ext_name"
                # Restore backup if conversion failed
                if [[ -f "$png_file.bak" ]]; then
                    mv "$png_file.bak" "$png_file"
                    log_info "  Restored original PNG"
                fi
                return 1
            fi
        else
            log_error "  Failed to create PNG for $ext_name"
            return 1
        fi
    else
        log_error "  Conversion failed for $ext_name"
        # Restore backup if conversion failed
        if [[ -f "$png_file.bak" ]]; then
            mv "$png_file.bak" "$png_file"
            log_info "  Restored original PNG"
        fi
        return 1
    fi
}

# Main script
main() {
    local target_extension="${1:-}"
    
    echo ""
    log_info "Vicinae Extension Icon Converter (SVG → PNG)"
    log_info "Output size: ${SIZE}x${SIZE}"
    echo ""
    
    # Check for rsvg-convert
    check_dependencies
    echo ""
    
    # Process extensions
    local processed=0
    local failed=0
    local skipped=0
    
    if [[ -n "$target_extension" ]]; then
        # Process single extension
        local ext_dir="$SCRIPT_DIR/$target_extension"
        if [[ ! -d "$ext_dir" ]]; then
            log_error "Extension directory not found: $target_extension"
            exit 1
        fi
        
        if process_extension "$ext_dir"; then
            ((processed++))
        else
            ((failed++))
        fi
    else
        # Process all extensions
        for ext_dir in "$SCRIPT_DIR"/*/ ; do
            # Skip if not a directory or if it's a hidden directory
            [[ -d "$ext_dir" ]] || continue
            [[ "$(basename "$ext_dir")" == .* ]] && continue
            
            local svg_file="$ext_dir/assets/extension_icon.svg"
            if [[ ! -f "$svg_file" ]]; then
                ((skipped++))
                log_warning "Skipping $(basename "$ext_dir"): No SVG icon found"
                continue
            fi
            
            if process_extension "$ext_dir"; then
                ((processed++))
            else
                ((failed++))
            fi
        done
    fi
    
    # Summary
    echo ""
    log_info "========================================="
    log_info "Conversion Summary:"
    log_success "  Processed: $processed"
    if [[ $failed -gt 0 ]]; then
        log_error "  Failed:    $failed"
    fi
    if [[ $skipped -gt 0 ]]; then
        log_warning "  Skipped:   $skipped (no SVG icon)"
    fi
    log_info "========================================="
    echo ""
    
    # Exit with error if any conversions failed
    if [[ $failed -gt 0 ]]; then
        exit 1
    fi
}

# Run main function with all arguments
main "$@"
