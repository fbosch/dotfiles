#!/usr/bin/env bash
set -euo pipefail

branch="$(basename "$(git symbolic-ref refs/remotes/origin/HEAD)")"

git worktree prune

worktree_path="$({
  git worktree list --porcelain | awk -v branch="$branch" '
    BEGIN { RS = ""; FS = "\n" }
    {
      current_worktree = ""
      current_branch = ""
      is_prunable = 0

      for (i = 1; i <= NF; i++) {
        line = $i
        if (line ~ /^worktree /) {
          current_worktree = substr(line, 10)
        } else if (line ~ /^branch /) {
          current_branch = substr(line, 8)
        } else if (line ~ /^prunable( |$)/) {
          is_prunable = 1
        }
      }

      if (current_branch == "refs/heads/" branch && is_prunable == 0) {
        print current_worktree
        exit
      }
    }
  '
})"

git fetch --prune origin "$branch"

if [ -n "$worktree_path" ] && [ -d "$worktree_path" ]; then
  git -C "$worktree_path" merge --ff-only "origin/$branch"
fi
