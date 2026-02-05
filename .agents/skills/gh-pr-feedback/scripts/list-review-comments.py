#!/usr/bin/env python3
import argparse
import json
import sys


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print review comments with key fields."
    )
    parser.add_argument("json_path", help="Path to JSON file with review comments")
    args = parser.parse_args()

    data = load_json(args.json_path)
    if not isinstance(data, list):
        print("Expected a JSON array of comments.", file=sys.stderr)
        return 1

    for comment in data:
        user = comment.get("user") or {}
        print("id", comment.get("id"))
        print("user", user.get("login"))
        print("path", comment.get("path"))
        print("line", comment.get("line"), "start_line", comment.get("start_line"))
        print("html_url", comment.get("html_url"))
        print("review_id", comment.get("pull_request_review_id"))
        print("body:", comment.get("body"))
        print("---")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
