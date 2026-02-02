#!/usr/bin/env python3

import argparse
import json
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--baseline", default="")
    parser.add_argument("--extras", default="")
    parser.add_argument("--print-top", type=int, default=5)
    parser.add_argument("--print-component-top", type=int, default=3)
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


def summarize_components(records):
    grouped = defaultdict(list)
    for record in records:
        grouped[record["component"]].append(record["duration_ms"])

    summary = {}
    for component, durations in grouped.items():
        summary[component] = {
            "count": len(durations),
            "avg_ms": statistics.mean(durations),
            "min_ms": min(durations),
            "max_ms": max(durations),
            "p95_ms": percentile(durations, 0.95),
            "p99_ms": percentile(durations, 0.99),
        }
    return summary


def top_metrics(metrics, count):
    items = list(metrics.items())
    items.sort(key=lambda item: item[1].get("avg_ms", 0.0), reverse=True)
    return items[:count]


def top_metrics_by_component(metrics, count):
    grouped = defaultdict(list)
    for key, stats in metrics.items():
        component = key.split(".", 1)[0]
        grouped[component].append((key, stats))
    for component in grouped:
        grouped[component].sort(
            key=lambda item: item[1].get("avg_ms", 0.0), reverse=True
        )
        grouped[component] = grouped[component][:count]
    return grouped


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
    component_metrics = summarize_components(records)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "components": component_metrics,
    }

    if args.extras:
        extras_path = Path(args.extras)
        if extras_path.exists():
            with open(extras_path, "r", encoding="utf-8") as handle:
                summary["extras"] = json.load(handle)

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
    if args.print_top > 0:
        print(f"Top {args.print_top} avg_ms metrics:")
        for key, stats in top_metrics(metrics, args.print_top):
            print(
                f"- {key}: avg {stats['avg_ms']:.2f}ms "
                f"p95 {stats['p95_ms']:.2f}ms count {stats['count']}"
            )
    if component_metrics:
        print("Per-component summary:")
        for component, stats in sorted(component_metrics.items()):
            print(
                f"- {component}: avg {stats['avg_ms']:.2f}ms "
                f"p95 {stats['p95_ms']:.2f}ms count {stats['count']}"
            )
    if args.print_component_top > 0:
        print(f"Top {args.print_component_top} per component:")
        for component, items in sorted(
            top_metrics_by_component(metrics, args.print_component_top).items()
        ):
            print(f"- {component}")
            for key, stats in items:
                print(
                    f"  {key}: avg {stats['avg_ms']:.2f}ms "
                    f"p95 {stats['p95_ms']:.2f}ms count {stats['count']}"
                )
    extras = summary.get("extras", {})
    component_memory = extras.get("component_memory_delta_kb")
    if component_memory:
        print("Component memory delta (kb):")
        for component, values in sorted(component_memory.items()):
            rss = values.get("rss")
            pss = values.get("pss")
            print(f"- {component}: rss {rss} pss {pss}")
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
