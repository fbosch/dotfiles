#!/usr/bin/env bash
set -euo pipefail

exec "$HERDR_PLUGIN_ROOT/scripts/project.sh" mprocs "$PWD"
