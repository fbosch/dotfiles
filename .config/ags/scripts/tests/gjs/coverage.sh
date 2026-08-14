#!/usr/bin/env bash
set -euo pipefail

coverage_dir="$(mktemp -d "${TMPDIR:-/tmp}/ags-gjs-coverage.XXXXXX")"

GJS_COVERAGE_PREFIXES=file \
GJS_COVERAGE_OUTPUT="$coverage_dir" \
ags run --gtk 4 scripts/tests/gjs/run.ts

coverage_file="$coverage_dir/coverage.lcov"
if [[ ! -s "$coverage_file" ]]; then
  printf 'GJS coverage report was not generated: %s\n' "$coverage_file" >&2
  exit 1
fi

printf 'GJS coverage: %s\n' "$coverage_file"
