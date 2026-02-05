#!/usr/bin/env python3
import argparse
import json
import sys


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def summarize_comment(comment: dict) -> dict:
    user = comment.get("user") or {}
    return {
        "id": comment.get("id"),
        "in_reply_to_id": comment.get("in_reply_to_id"),
        "user_login": user.get("login"),
        "path": comment.get("path"),
        "line": comment.get("line"),
        "start_line": comment.get("start_line"),
        "html_url": comment.get("html_url"),
        "pull_request_review_id": comment.get("pull_request_review_id"),
        "body": comment.get("body"),
        "resolved": comment.get("resolved"),
        "outdated": comment.get("outdated"),
    }


def group_threads(comments: list[dict]) -> tuple[dict, bool]:
    has_in_reply_to = any("in_reply_to_id" in comment for comment in comments)
    threads: dict[object, list[dict]] = {}
    if has_in_reply_to:
        for comment in comments:
            thread_id = comment.get("in_reply_to_id") or comment.get("id")
            threads.setdefault(thread_id, []).append(comment)
    else:
        for comment in comments:
            threads[comment.get("id")] = [comment]
    return threads, has_in_reply_to


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse GitHub PR review comments JSON into thread groups."
    )
    parser.add_argument("json_path", help="Path to JSON file with review comments")
    args = parser.parse_args()

    data = load_json(args.json_path)
    if not isinstance(data, list):
        print("Expected a JSON array of comments.", file=sys.stderr)
        return 1

    fields = set()
    for comment in data:
        fields.update(comment.keys())

    threads, has_in_reply_to = group_threads(data)

    output = {
        "source_path": args.json_path,
        "count": len(data),
        "has_in_reply_to_id": has_in_reply_to,
        "has_resolved": "resolved" in fields,
        "has_outdated": "outdated" in fields,
        "threads": [
            {
                "thread_id": thread_id,
                "comments": [summarize_comment(comment) for comment in comments],
            }
            for thread_id, comments in threads.items()
        ],
    }

    json.dump(output, sys.stdout, indent=2, ensure_ascii=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
