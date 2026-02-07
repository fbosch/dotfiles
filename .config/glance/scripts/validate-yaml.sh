#!/usr/bin/env bash
# YAML validation script for Glance configuration files
# Uses Glance's built-in config:validate command

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔍 Validating Glance configuration..."
echo

# Check if glance binary is available in PATH
if command -v glance &> /dev/null; then
    echo "  Using: glance config:validate"
    echo
    
    cd "$CONFIG_DIR"
    if glance --config glance.yml config:validate 2>&1; then
        echo
        echo "✅ Glance configuration is valid!"
        exit 0
    else
        echo
        echo "❌ Glance configuration validation failed"
        exit 1
    fi
fi

# Fallback: Use Glance container for validation
echo "⚠️  glance binary not found in PATH"
echo "   Using Glance container for validation..."
echo

if podman run --rm -v "$CONFIG_DIR:/app/config:ro" docker.io/glanceapp/glance:latest --config /app/config/glance.yml config:validate 2>&1; then
    echo
    echo "✅ Glance configuration is valid!"
    exit 0
else
    echo
    echo "❌ Glance configuration validation failed"
    exit 1
fi
