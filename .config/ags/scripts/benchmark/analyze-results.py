#!/usr/bin/env python3

import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--baseline", default="")
    return parser.parse_args()


def load_jsonl(path):
    records = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def percentile(values, pct):
    if not values:
        return 0.0
    values_sorted = sorted(values)
    index = int(round((len(values_sorted) - 1) * pct))
    return values_sorted[index]


def summarize(records):
    grouped = defaultdict(list)
    for record in records:
        key = f"{record['component']}.{record['name']}"
        grouped[key].append(record)

    metrics = {}
    for key, items in grouped.items():
        durations = [item["duration_ms"] for item in items]
        metrics[key] = {
            "count": len(durations),
            "avg_ms": statistics.mean(durations),
            "min_ms": min(durations),
            "max_ms": max(durations),
            "p95_ms": percentile(durations, 0.95),
            "p99_ms": percentile(durations, 0.99),
        }
    return metrics


def compare_to_baseline(current, baseline):
    comparisons = []
    for key, current_stats in current.items():
        base_stats = baseline.get("metrics", {}).get(key)
        if not base_stats:
            continue
        avg_delta = current_stats["avg_ms"] - base_stats["avg_ms"]
        p95_delta = current_stats["p95_ms"] - base_stats["p95_ms"]
        comparisons.append(
            {
                "metric": key,
                "avg_delta_ms": avg_delta,
                "p95_delta_ms": p95_delta,
                "avg_delta_pct": (avg_delta / base_stats["avg_ms"]) * 100
                if base_stats["avg_ms"]
                else 0.0,
                "p95_delta_pct": (p95_delta / base_stats["p95_ms"]) * 100
                if base_stats["p95_ms"]
                else 0.0,
            }
        )
    return comparisons


def main():
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    if not input_path.exists():
        print(f"Missing input file: {input_path}", file=sys.stderr)
        sys.exit(1)

    records = load_jsonl(input_path)
    metrics = summarize(records)
    summary = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "metrics": metrics,
    }

    baseline_path = Path(args.baseline) if args.baseline else None
    if baseline_path and baseline_path.exists():
        with open(baseline_path, "r", encoding="utf-8") as handle:
            baseline = json.load(handle)
        summary["baseline"] = str(baseline_path)
        summary["comparisons"] = compare_to_baseline(metrics, baseline)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)

    print(f"Summary written to {output_path}")
    if summary.get("comparisons"):
        print("Baseline comparison:")
        for item in summary["comparisons"]:
            avg = item["avg_delta_ms"]
            p95 = item["p95_delta_ms"]
            avg_pct = item["avg_delta_pct"]
            p95_pct = item["p95_delta_pct"]
            print(
                f"- {item['metric']}: avg {avg:+.2f}ms ({avg_pct:+.1f}%), "
                f"p95 {p95:+.2f}ms ({p95_pct:+.1f}%)"
            )


if __name__ == "__main__":
    main()
