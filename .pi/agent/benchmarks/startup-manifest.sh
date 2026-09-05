#!/usr/bin/env bash

# Startup can rewrite these outputs without changing the workload's source inputs.
# Keep links and unexpected paths in the immutable manifest, even under a runtime directory.
split_fixture_manifest() {
  local source_manifest="$1"
  local immutable_manifest="$2"
  local runtime_manifest="$3"

  : >"$immutable_manifest"
  : >"$runtime_manifest"
  awk -F '\t' -v immutable="$immutable_manifest" -v runtime="$runtime_manifest" '
    $2 ~ /^file:/ && ($1 ~ /^agent\/fff\/(frecency|history)\/(data|lock)\.mdb$/ ||
      $1 ~ /^agent\/sessions\/permission-forwarding\/serving\/[^/]+\.json$/ ||
      $1 ~ /^tmp\/jiti\/[^/]+\.[0-9a-f]{8}\.[cm]js$/) { print > runtime; next }
    { print > immutable }
  ' "$source_manifest"
}
