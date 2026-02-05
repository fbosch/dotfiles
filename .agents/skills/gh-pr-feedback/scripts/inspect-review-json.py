#!/usr/bin/env python3
import argparse
import json
import sys


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspect structure of GitHub PR review comments JSON."
    )
    parser.add_argument("json_path", help="Path to JSON file with review comments")
    args = parser.parse_args()

    data = load_json(args.json_path)
    if not isinstance(data, list):
        print("Expected a JSON array of comments.", file=sys.stderr)
        return 1

    print(f"type: {type(data).__name__}")
    print(f"count: {len(data)}")

    fields = set()
    for comment in data:
        fields.update(comment.keys())

    print("has_in_reply_to_id:", any("in_reply_to_id" in c for c in data))
    print("has_resolved:", "resolved" in fields)
    print("has_outdated:", "outdated" in fields)
    print(
        "fields_with_res_or_out:",
        sorted([k for k in fields if "res" in k or "out" in k]),
    )

    if data:
        print("keys:", sorted(list(data[0].keys())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
