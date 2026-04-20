#!/usr/bin/env bash
set -euo pipefail

RAW_INPUT="${1:-}"

python3 - <<'PY' "$RAW_INPUT"
import json
import re
import subprocess
import sys
from urllib.parse import urlparse


def run_json(cmd):
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        message = (process.stderr or process.stdout).strip()
        raise RuntimeError(message or f"command failed: {' '.join(cmd)}")
    try:
        return json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"invalid JSON from {' '.join(cmd)}: {error}") from error


def fail(message):
    print(f"ERROR: {message}")
    sys.exit(0)


def parse_url(url):
    parsed = urlparse(url)
    if parsed.netloc.lower() != "github.com":
        return None

    match = re.search(r"^/([^/]+)/([^/]+)/pull/(\d+)", parsed.path)
    if match is None:
        return None

    owner = match.group(1)
    repo = match.group(2)
    number = int(match.group(3))

    review_id = None
    comment_id = None
    if parsed.fragment:
        review_match = re.search(r"pullrequestreview-(\d+)", parsed.fragment)
        comment_match = re.search(r"discussion_r(\d+)", parsed.fragment)
        if review_match is not None:
            review_id = int(review_match.group(1))
        if comment_match is not None:
            comment_id = int(comment_match.group(1))

    return {
        "owner": owner,
        "repo": repo,
        "number": number,
        "reviewId": review_id,
        "commentId": comment_id,
        "source": "url",
        "url": f"https://github.com/{owner}/{repo}/pull/{number}",
    }


def parse_input(raw):
    text = raw.strip()
    if text.startswith("resolve "):
        text = text[len("resolve ") :].strip()

    if text == "":
        return None

    url_match = re.search(r"https://github\.com/[^\s]+", text)
    if url_match is not None:
        parsed = parse_url(url_match.group(0))
        if parsed is not None:
            return parsed

    num_match = re.fullmatch(r"\d+", text)
    if num_match is not None:
        number = int(num_match.group(0))
        repo = run_json(["gh", "repo", "view", "--json", "nameWithOwner"]) 
        owner_repo = repo.get("nameWithOwner", "")
        if "/" not in owner_repo:
            fail("Could not infer owner/repo from current git remote")
        owner, repo_name = owner_repo.split("/", 1)
        return {
            "owner": owner,
            "repo": repo_name,
            "number": number,
            "reviewId": None,
            "commentId": None,
            "source": "number",
            "url": f"https://github.com/{owner}/{repo_name}/pull/{number}",
        }

    inline_num_match = re.search(r"\b(\d+)\b", text)
    if inline_num_match is not None:
        number = int(inline_num_match.group(1))
        repo = run_json(["gh", "repo", "view", "--json", "nameWithOwner"]) 
        owner_repo = repo.get("nameWithOwner", "")
        if "/" not in owner_repo:
            fail("Could not infer owner/repo from current git remote")
        owner, repo_name = owner_repo.split("/", 1)
        return {
            "owner": owner,
            "repo": repo_name,
            "number": number,
            "reviewId": None,
            "commentId": None,
            "source": "text-number",
            "url": f"https://github.com/{owner}/{repo_name}/pull/{number}",
        }

    fail("Could not parse a PR URL or number from input")


raw_input = sys.argv[1]

try:
    parsed = parse_input(raw_input)
except RuntimeError as error:
    fail(str(error))

if parsed is None:
    try:
        pr = run_json(["gh", "pr", "view", "--json", "number,url"])
    except RuntimeError as error:
        fail(f"Could not infer PR from current branch: {error}")

    url = pr.get("url", "")
    parsed_url = parse_url(url)
    if parsed_url is None:
        fail("Current branch is not associated with a GitHub PR")

    parsed_url["source"] = "branch"
    parsed = parsed_url

try:
    details = run_json(
        [
            "gh",
            "pr",
            "view",
            str(parsed["number"]),
            "--repo",
            f"{parsed['owner']}/{parsed['repo']}",
            "--json",
            "number,title,url",
        ]
    )
except RuntimeError as error:
    fail(
        "Failed to validate PR identity "
        f"for {parsed['owner']}/{parsed['repo']}#{parsed['number']}: {error}"
    )

parsed["title"] = details.get("title", "")
parsed["url"] = details.get("url", parsed["url"])
parsed["number"] = details.get("number", parsed["number"])

print(json.dumps(parsed))
PY
