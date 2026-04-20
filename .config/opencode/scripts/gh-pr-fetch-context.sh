#!/usr/bin/env bash
set -euo pipefail

RAW_INPUT="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IDENTITY="$(bash "$SCRIPT_DIR/gh-pr-identify.sh" "$RAW_INPUT")"
if [[ "$IDENTITY" == ERROR:* ]]; then
  echo "$IDENTITY"
  exit 0
fi

python3 - <<'PY' "$IDENTITY"
import json
import subprocess
import sys


def run_json(cmd):
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        output = (process.stderr or process.stdout).strip()
        raise RuntimeError(output or f"command failed: {' '.join(cmd)}")
    try:
        return json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"invalid JSON from {' '.join(cmd)}: {error}") from error


def fetch_rest_pages(owner, repo, number, resource):
    items = []
    page = 1
    while True:
        result = run_json(
            [
                "gh",
                "api",
                f"repos/{owner}/{repo}/pulls/{number}/{resource}",
                "--method",
                "GET",
                "-f",
                f"per_page=100",
                "-f",
                f"page={page}",
            ]
        )
        if isinstance(result, list) is False:
            raise RuntimeError(f"expected array from pulls/{number}/{resource}")
        items.extend(result)
        if len(result) < 100:
            break
        page += 1
    return items


def fetch_graphql_threads(owner, repo, number):
    query = """
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      title
      url
      reviewThreads(first: 100, after: $after) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              bodyText
              createdAt
              url
              author {
                login
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
"""

    threads = []
    cursor = None

    while True:
        cmd = [
            "gh",
            "api",
            "graphql",
            "-f",
            f"query={query}",
            "-F",
            f"owner={owner}",
            "-F",
            f"repo={repo}",
            "-F",
            f"number={number}",
        ]
        if cursor is not None:
            cmd.extend(["-F", f"after={cursor}"])

        payload = run_json(cmd)
        pull = payload.get("data", {}).get("repository", {}).get("pullRequest")
        if isinstance(pull, dict) is False:
            raise RuntimeError("GraphQL response missing pullRequest")

        batch = pull.get("reviewThreads", {}).get("nodes", [])
        if isinstance(batch, list) is False:
            raise RuntimeError("GraphQL response missing reviewThreads")

        threads.extend(batch)

        page_info = pull.get("reviewThreads", {}).get("pageInfo", {})
        has_next = bool(page_info.get("hasNextPage"))
        if has_next is False:
            break
        cursor = page_info.get("endCursor")
        if cursor in (None, ""):
            break

    return threads


def fail(message):
    print(f"ERROR: {message}")
    sys.exit(0)


identity = json.loads(sys.argv[1])
owner = identity["owner"]
repo = identity["repo"]
number = identity["number"]

try:
    threads = fetch_graphql_threads(owner, repo, number)
except RuntimeError as error:
    try:
        rest_comments = fetch_rest_pages(owner, repo, number, "comments")
        reviews = fetch_rest_pages(owner, repo, number, "reviews")
    except RuntimeError as rest_error:
        fail(f"Failed to fetch review context: {error}; REST fallback also failed: {rest_error}")

    result = {
        "identity": identity,
        "transport": "rest-fallback",
        "reviews": reviews,
        "reviewComments": rest_comments,
        "reviewThreads": [],
    }
    print(json.dumps(result))
    sys.exit(0)

try:
    rest_comments = fetch_rest_pages(owner, repo, number, "comments")
    reviews = fetch_rest_pages(owner, repo, number, "reviews")
except RuntimeError as error:
    fail(f"Failed to fetch REST metadata for filtering: {error}")

result = {
    "identity": identity,
    "transport": "graphql",
    "reviews": reviews,
    "reviewComments": rest_comments,
    "reviewThreads": threads,
}

print(json.dumps(result))
PY
