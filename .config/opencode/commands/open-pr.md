---
description: Open a pull request for the current branch on GitHub or Azure DevOps
agent: quick
---

Open a pull request for the current branch.

Use the `open_pr` tool for provider routing, pushing, and PR creation. Do not run inline shell for PR opening.

PR content policy:

Use the `pr-description` skill for PR body structure, reviewer focus, validation, and risk framing.

Additional context:
$ARGUMENTS

Provider override:
$1

Instructions:

1. Use only the auto-generated git context below plus Additional context to generate PR content using the policy above: first line is `title`, remaining lines are markdown `body`.
2. If generated PR content would be one of the `Cannot generate PR description:` errors, output only that error and stop.
3. If Provider override is exactly `gh` or `github`, call `open_pr` with `provider: "gh"` plus `title` and `body`.
4. If Provider override is exactly `az` or `azure-devops`, call `open_pr` with `provider: "az"` plus `title` and `body`.
5. Otherwise, call `open_pr` with only `title` and `body`.
6. Call `open_pr` exactly once.
7. If tool output starts with `ERROR:`, output only that error and stop.
8. On success, output only the PR URL or success output returned by the tool.

AUTO-GENERATED GIT CONTEXT:
!`sh -c '
branch=$(git rev-parse --abbrev-ref HEAD)
base=""
provider="$1"
remote=""

case "$provider" in
gh|github)
for name in $(git remote); do
url=$(git remote get-url "$name" 2>/dev/null || true)
case "$url" in
_github.com_) remote=$name; break ;;
esac
done
;;
az|azure-devops)
for name in $(git remote); do
url=$(git remote get-url "$name" 2>/dev/null || true)
case "$url" in
_dev.azure.com_|_visualstudio.com_) remote=$name; break ;;
esac
done
;;
esac

if [ -z "$remote" ]; then
remote=$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null | cut -d/ -f1 || true)
fi

if [ -z "$remote" ]; then
if git remote | grep -qx origin; then
remote=origin
else
remote=$(git remote | head -n 1)
fi
fi

if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
base=$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null || true)
fi

if [ -z "$base" ]; then
remote_head=$(git symbolic-ref --quiet --short "refs/remotes/$remote/HEAD" 2>/dev/null || true)
if [ -n "$remote_head" ]; then
base=$remote_head
fi
fi

if [ -z "$base" ]; then
for ref in "$remote/main" "$remote/master" "$remote/develop" "$remote/dev" "$remote/trunk" origin/main origin/master origin/develop origin/dev origin/trunk main master develop dev trunk; do
if git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null; then
base=$ref
break
fi
done
fi

echo "Branch: $branch"

if [ -z "$base" ]; then
echo "Base: (not found)"
echo "Commits:"
echo "(failed to determine base branch)"
echo
echo "DIFF:"
git diff --ignore-all-space -- ':!_lock._' ':!pnpm-lock.yaml'
exit 0
fi

merge_base=$(git merge-base HEAD "$base" 2>/dev/null || true)

echo "Base: $base"
echo "Commits:"

if [ -z "$merge_base" ]; then
echo "(failed to determine merge base)"
echo
echo "DIFF:"
git diff --ignore-all-space -- ':!_lock._' ':!pnpm-lock.yaml'
exit 0
fi

commits=$(git log --no-merges --pretty=format:"- %s" "$merge_base..HEAD")
if [ -n "$commits" ]; then
printf "%s\n" "$commits"
else
echo "(none)"
fi

echo
echo "DIFF:"
git diff --ignore-all-space "$merge_base..HEAD" -- ':!_lock._' ':!pnpm-lock.yaml'
'`
