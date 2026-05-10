#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

lua "$script_dir/hotpaths.lua" "${1:-all}" "${2:-${HYPR_BENCH_ITERATIONS:-10000}}"
