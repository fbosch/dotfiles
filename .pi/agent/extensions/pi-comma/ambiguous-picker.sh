#!/usr/bin/env bash
# comma sends its candidate list to stdin. Report it without making a selection.
set -u

limit=10
count=0
while IFS= read -r candidate || [[ -n "$candidate" ]]; do
  count=$((count + 1))
  if (( count <= limit )); then
    printf 'pi-comma: candidate: %s\n' "$candidate" >&2
  fi
done

if (( count > limit )); then
  printf 'pi-comma: candidate list truncated after %d entries\n' "$limit" >&2
fi
printf 'pi-comma: multiple providers found; choose one with comma directly\n' >&2
exit 1
