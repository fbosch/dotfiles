#!/usr/bin/env bash
# comma sends its candidate list to stdin. Report it without making a selection.
set -u

limit=10
count=0
while IFS= read -r candidate || [[ -n "$candidate" ]]; do
  count=$((count + 1))
  if (( count <= limit )); then
    printf 'pi-comma: candidate: %q\n' "${candidate:0:512}" >&2
    if (( ${#candidate} > 512 )); then
      printf '%s\n' 'pi-comma: candidate truncated at 512 characters' >&2
    fi
  fi
done

if (( count > limit )); then
  printf 'pi-comma: candidate list truncated after %d entries\n' "$limit" >&2
fi
printf 'pi-comma: multiple providers found; choose one with comma directly\n' >&2
exit 1
