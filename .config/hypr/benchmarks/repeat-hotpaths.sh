#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
group="${1:-all}"
iterations="${2:-${HYPR_BENCH_ITERATIONS:-10000}}"
runs="${3:-5}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

for run in $(seq 1 "$runs"); do
	printf 'RUN %s/%s group=%s iterations=%s\n' "$run" "$runs" "$group" "$iterations" >&2
	"$script_dir/run-hotpaths.sh" "$group" "$iterations" \
		| while IFS= read -r line; do
			printf '%s\n' "$line" >&2
			metric="${line%% *}"
			value="$(awk '{ for (i = 1; i <= NF; i++) if ($i == "us/call") print $(i - 1) }' <<< "$line")"
			[[ -n "$metric" && -n "$value" ]] || continue
			printf '%s\t%s\n' "$metric" "$value" >> "$tmp"
		done
done

awk '
	{
		metrics[$1] = 1
		values[$1, ++counts[$1]] = $2 + 0
	}
	END {
		printf "%-34s %4s %10s %10s %10s\n", "metric", "runs", "min", "median", "max"
		for (metric in metrics) {
			count = counts[metric]
			for (i = 1; i <= count; i++) sorted[i] = values[metric, i]
			for (i = 1; i <= count; i++) {
				for (j = i + 1; j <= count; j++) {
					if (sorted[j] < sorted[i]) {
						tmp = sorted[i]
						sorted[i] = sorted[j]
						sorted[j] = tmp
					}
				}
			}
			if (count % 2 == 1) {
				median = sorted[(count + 1) / 2]
			} else {
				median = (sorted[count / 2] + sorted[count / 2 + 1]) / 2
			}
			printf "%-34s %4d %10.3f %10.3f %10.3f\n", metric, count, sorted[1], median, sorted[count]
		}
	}
' "$tmp"
