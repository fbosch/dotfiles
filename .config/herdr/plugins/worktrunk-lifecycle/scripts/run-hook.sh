#!/usr/bin/env bash

set -euo pipefail

hook_type=$1
event=$HERDR_PLUGIN_EVENT_JSON
worktree_path=$(jq -er '.data.worktree.path' <<<"$event")

case "$hook_type" in
  pre-start)
    # The checkout exists, so Worktrunk can resolve its project config and context.
    exec wt -C "$worktree_path" hook post-start
    ;;
  post-remove)
    # Herdr has removed the checkout; run cleanup from the surviving repository root.
    repo_root=$(jq -er '.data.workspace.worktree.repo_root' <<<"$event")
    branch=$(jq -er '.data.worktree.branch' <<<"$event")
    worktree_name=$(basename "$worktree_path")
    exec wt -C "$repo_root" hook post-remove \
      --branch="$branch" \
      --worktree-path="$worktree_path" \
      --worktree-name="$worktree_name"
    ;;
  *)
    printf 'unsupported Worktrunk hook type: %s\n' "$hook_type" >&2
    exit 2
    ;;
esac
