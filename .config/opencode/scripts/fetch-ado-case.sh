#!/usr/bin/env bash
set -euo pipefail

ID="$1"

# Validate test case ID is numeric
if ! [[ "$ID" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Invalid test case ID. Must be numeric."
  exit 1
fi

# Detect organization from git remote if available
ORG_ARG=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  REMOTE_URL=$(git config --get remote.origin.url || echo "")
  if [[ "$REMOTE_URL" =~ dev\.azure\.com ]]; then
    ORG=$(echo "$REMOTE_URL" | grep -o 'dev\.azure\.com/[^/]\+' | cut -d/ -f2)
    if [[ -n "$ORG" ]]; then
      ORG_ARG="--org https://dev.azure.com/$ORG"
    fi
  fi
fi

# Fetch test case
if ! az boards work-item show --id "$ID" $ORG_ARG --output json 2>&1; then
  echo "ERROR: Failed to fetch test case #$ID. Ensure Azure CLI is authenticated and the test case exists."
  exit 1
fi
