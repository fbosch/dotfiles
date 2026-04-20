#!/usr/bin/env python3
import json
import re
import sys


def strip_agent_noise(text):
    if isinstance(text, str) is False:
        return ""

    lines = text.splitlines()
    kept = []
    skip = False

    for line in lines:
        lower = line.strip().lower()
        if lower.startswith("### analysis") or lower.startswith("### tool output"):
            skip = True
            continue
        if skip and lower.startswith("### "):
            skip = False
        if skip:
            continue
        kept.append(line)

    cleaned = "\n".join(kept).strip()
    return cleaned


def classify_severity(text):
    lower = text.lower()
    if "must" in lower or "request changes" in lower or "blocking" in lower:
        return "request-changes"
    if "should" in lower or "please" in lower or "fix" in lower:
        return "should-fix"
    if "nit" in lower:
        return "nit"
    return "info"


def to_range(start_line, line):
    if isinstance(line, int) and isinstance(start_line, int) and start_line != line:
        return f"{start_line}-{line}"
    if isinstance(line, int):
        return str(line)
    if isinstance(start_line, int):
        return str(start_line)
    return "unknown"


def normalize_thread(thread, review_id_by_comment, target_review_id, target_comment_id):
    comments = thread.get("comments", {}).get("nodes", [])
    if isinstance(comments, list) is False or len(comments) == 0:
        return None

    db_comment_ids = [c.get("databaseId") for c in comments if isinstance(c.get("databaseId"), int)]
    if isinstance(target_comment_id, int) and target_comment_id not in db_comment_ids:
        return None

    if isinstance(target_review_id, int):
        if any(review_id_by_comment.get(comment_id) == target_review_id for comment_id in db_comment_ids) is False:
            return None

    root = comments[0]
    joined = "\n\n".join(
        f"@{(comment.get('author') or {}).get('login') or 'unknown'}: {comment.get('body') or ''}"
        for comment in comments
    ).strip()

    actionable_text = strip_agent_noise(joined)
    if actionable_text == "":
        actionable_text = strip_agent_noise(root.get("body") or "")

    path = thread.get("path") or "unknown"
    start_line = thread.get("startLine")
    line = thread.get("line")
    line_range = to_range(start_line, line)

    normalized = {
        "threadId": thread.get("id"),
        "commentId": root.get("databaseId"),
        "path": path,
        "line": line,
        "startLine": start_line,
        "lineRange": line_range,
        "pathLine": f"{path}:{line_range}",
        "isResolved": bool(thread.get("isResolved")),
        "isOutdated": bool(thread.get("isOutdated")),
        "authorLogins": [
            (comment.get("author") or {}).get("login")
            for comment in comments
            if (comment.get("author") or {}).get("login")
        ],
        "actionableText": actionable_text,
        "severity": classify_severity(actionable_text),
    }

    return normalized


def main():
    raw = sys.stdin.read().strip()
    if raw.startswith("ERROR:"):
        print(raw)
        return

    if raw == "":
        print("ERROR: Empty review context")
        return

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"ERROR: Invalid review context JSON: {error}")
        return

    identity = payload.get("identity", {})
    review_comments = payload.get("reviewComments", [])
    threads = payload.get("reviewThreads", [])

    target_review_id = identity.get("reviewId")
    target_comment_id = identity.get("commentId")

    review_id_by_comment = {}
    if isinstance(review_comments, list):
        for comment in review_comments:
            comment_id = comment.get("id")
            review_id = comment.get("pull_request_review_id")
            if isinstance(comment_id, int) and isinstance(review_id, int):
                review_id_by_comment[comment_id] = review_id

    normalized_threads = []
    if isinstance(threads, list):
        for thread in threads:
            normalized = normalize_thread(thread, review_id_by_comment, target_review_id, target_comment_id)
            if normalized is None:
                continue
            if normalized["isResolved"]:
                continue
            normalized_threads.append(normalized)

    duplicates = {}
    for item in normalized_threads:
        key_text = re.sub(r"\s+", " ", item["actionableText"].strip().lower())
        key_text = key_text[:180]
        duplicate_key = f"{item['path']}|{key_text}"
        duplicates.setdefault(duplicate_key, []).append(item)

    merged = []
    for _, group in duplicates.items():
        if len(group) == 1:
            merged.append(group[0])
            continue

        first = group[0]
        authors = []
        for thread in group:
            for author in thread["authorLogins"]:
                if author not in authors:
                    authors.append(author)

        first["authorLogins"] = authors
        first["corroboratedBy"] = authors
        merged.append(first)

    output = {
        "pr": {
            "owner": identity.get("owner"),
            "repo": identity.get("repo"),
            "number": identity.get("number"),
            "url": identity.get("url"),
            "title": identity.get("title"),
        },
        "scope": {
            "source": identity.get("source"),
            "reviewId": identity.get("reviewId"),
            "commentId": identity.get("commentId"),
        },
        "transport": payload.get("transport"),
        "threads": merged,
    }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
