#!/usr/bin/env bash
set -euo pipefail

branch="$(basename "$(git symbolic-ref refs/remotes/origin/HEAD)")"

worktree_path="$({
  git worktree list --porcelain | awk -v branch="$branch" '
    $1 == "worktree" { current = $2 }
    $1 == "branch" && $2 == "refs/heads/" branch {
      print current
      exit
    }
  '
})"

if [ -z "$worktree_path" ]; then
  echo "could not find worktree for $branch" >&2
  exit 1
fi

git -C "$worktree_path" pull --ff-only
