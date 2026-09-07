#!/usr/bin/env bash
set -euo pipefail

RAW_INPUT="${1:-}"

python3 - <<'PY' "$RAW_INPUT"
import difflib
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote, urlparse

MAX_CHANGED_FILES = int(os.getenv("ADO_PR_REVIEW_MAX_FILES", "200"))
MAX_DIFF_FILES = int(os.getenv("ADO_PR_REVIEW_MAX_DIFF_FILES", "60"))
MAX_FILE_DIFF_LINES = int(os.getenv("ADO_PR_REVIEW_MAX_FILE_DIFF_LINES", "500"))


def print_error(message):
    print(f"ERROR: {message}")


def run_command(command, env=None):
    process = subprocess.run(command, capture_output=True, text=True, env=env)
    if process.returncode != 0:
        output = (process.stderr or process.stdout).strip()
        if output == "":
            output = f"Command failed: {' '.join(command)}"
        raise RuntimeError(output)
    return process.stdout


def run_json(command, env=None):
    output = run_command(command, env=env)
    try:
        return json.loads(output)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Invalid JSON response: {error}") from error


def normalize_pr_input(raw_input):
    text = raw_input.strip()
    if text == "":
        return None, None

    if text.startswith("!"):
        text = text[1:].strip()

    if text.isdigit():
        return text, None

    url_match = re.search(r"/pullrequest/(\d+)", text, flags=re.IGNORECASE)
    if url_match is not None:
        return url_match.group(1), text

    if text.isdigit():
        return text, None

    return None, text


def parse_url_context(value):
    if value is None or value.startswith("http") is False:
        return {}

    parsed = urlparse(value)
    host = parsed.netloc.lower()
    segments = [unquote(segment) for segment in parsed.path.split("/") if segment]

    context = {}

    if host.endswith("dev.azure.com"):
        if len(segments) >= 1:
            context["org"] = f"https://dev.azure.com/{segments[0]}"
        if len(segments) >= 2:
            context["project"] = segments[1]
        if len(segments) >= 4 and segments[2] == "_git":
            context["repositoryName"] = segments[3]
        return context

    if host.endswith("visualstudio.com"):
        context["org"] = f"{parsed.scheme}://{parsed.netloc}"
        if len(segments) >= 1:
            context["project"] = segments[0]
        if len(segments) >= 3 and segments[1] == "_git":
            context["repositoryName"] = segments[2]
        return context

    return context


def parse_remote_url(remote_url):
    if remote_url == "":
        return {}

    context = {}

    dev_https_match = re.search(
        r"(?:https://|https://[^@]+@)dev\.azure\.com/([^/]+)/([^/]+)/_git/([^/]+)",
        remote_url,
    )
    if dev_https_match is not None:
        context["org"] = f"https://dev.azure.com/{dev_https_match.group(1)}"
        context["project"] = unquote(dev_https_match.group(2))
        context["repositoryName"] = unquote(dev_https_match.group(3))
        return context

    dev_ssh_match = re.search(r"ssh\.dev\.azure\.com:v3/([^/]+)/([^/]+)/([^/]+)", remote_url)
    if dev_ssh_match is not None:
        context["org"] = f"https://dev.azure.com/{dev_ssh_match.group(1)}"
        context["project"] = unquote(dev_ssh_match.group(2))
        context["repositoryName"] = unquote(dev_ssh_match.group(3))
        return context

    vs_match = re.search(r"https://([^.]+)\.visualstudio\.com/([^/]+)/_git/([^/]+)", remote_url)
    if vs_match is not None:
        context["org"] = f"https://{vs_match.group(1)}.visualstudio.com"
        context["project"] = unquote(vs_match.group(2))
        context["repositoryName"] = unquote(vs_match.group(3))
        return context

    return context


def detect_context_from_git_remote():
    process = subprocess.run(
        ["git", "config", "--get", "remote.origin.url"],
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        return {}

    remote_url = process.stdout.strip()
    if remote_url == "":
        return {}

    context = parse_remote_url(remote_url)
    if context:
        context["remoteUrl"] = remote_url
    return context


def infer_org_from_pr_url(pr_url):
    if not isinstance(pr_url, str) or pr_url == "":
        return None

    parsed = urlparse(pr_url)
    host = parsed.netloc.lower()
    segments = [unquote(segment) for segment in parsed.path.split("/") if segment]

    if host.endswith("dev.azure.com") and len(segments) >= 1:
        return f"https://dev.azure.com/{segments[0]}"
    if host.endswith("visualstudio.com"):
        return f"{parsed.scheme}://{parsed.netloc}"
    return None


def build_az_devops_env():
    env = dict(os.environ)
    env["AZURE_EXTENSION_USE_DYNAMIC_INSTALL"] = "yes_without_prompt"
    return env


def az_pr_show(pr_id, org, project, env):
    command = ["az", "repos", "pr", "show", "--id", pr_id, "--output", "json"]
    if org:
        command.extend(["--org", org])
    if project:
        command.extend(["--project", project])
    return run_json(command, env=env)


def az_pr_reviewers(pr_id, org, project, env):
    command = ["az", "repos", "pr", "reviewer", "list", "--id", pr_id, "--output", "json"]
    if org:
        command.extend(["--org", org])
    if project:
        command.extend(["--project", project])
    return run_json(command, env=env)


def az_invoke_git(resource, org, route_parameters, query_parameters, env):
    command = [
        "az",
        "devops",
        "invoke",
        "--area",
        "git",
        "--resource",
        resource,
        "--http-method",
        "GET",
        "--api-version",
        "7.1",
        "--output",
        "json",
    ]

    if org:
        command.extend(["--org", org])

    if route_parameters:
        command.append("--route-parameters")
        for key, value in route_parameters.items():
            if value is None:
                continue
            command.append(f"{key}={value}")

    if query_parameters:
        command.append("--query-parameters")
        for key, value in query_parameters.items():
            if value is None:
                continue
            command.append(f"{key}={value}")

    return run_json(command, env=env)


def is_probably_binary(text):
    if isinstance(text, str) is False:
        return True
    return "\x00" in text


def fetch_item_content(org, project, repository_id, path, commit, env):
    response = az_invoke_git(
        "items",
        org,
        {
            "project": project,
            "repositoryId": repository_id,
        },
        {
            "path": path,
            "includeContent": "true",
            "versionDescriptor.versionType": "commit",
            "versionDescriptor.version": commit,
            "resolveLfs": "true",
        },
        env,
    )

    content = response.get("content")
    if isinstance(content, str) is False:
        return None, "binary-or-nontext"
    if is_probably_binary(content):
        return None, "binary"
    return content, None


def build_unified_diff(path, before_text, after_text):
    before_lines = before_text.splitlines()
    after_lines = after_text.splitlines()
    diff_lines = list(
        difflib.unified_diff(
            before_lines,
            after_lines,
            fromfile=f"a{path}",
            tofile=f"b{path}",
            lineterm="",
        )
    )
    return diff_lines


def trim_diff_lines(diff_lines):
    if len(diff_lines) <= MAX_FILE_DIFF_LINES:
        return diff_lines, False
    clipped = diff_lines[:MAX_FILE_DIFF_LINES]
    clipped.append(f"... diff truncated after {MAX_FILE_DIFF_LINES} lines ...")
    return clipped, True


def extract_changed_files(change_entries):
    files = []
    seen = set()

    for entry in change_entries:
        item = entry.get("item") or {}
        path = item.get("path")
        if isinstance(path, str) is False or path == "":
            continue

        if path in seen:
            continue
        seen.add(path)

        files.append(
            {
                "path": path,
                "changeType": entry.get("changeType") or "unknown",
                "objectId": item.get("objectId"),
                "originalPath": entry.get("sourceServerItem"),
            }
        )

        if len(files) >= MAX_CHANGED_FILES:
            break

    return files


raw_input = sys.argv[1] if len(sys.argv) > 1 else ""
pr_id, raw_url = normalize_pr_input(raw_input)

if pr_id is None:
    if raw_input.strip() == "":
        print_error("Usage: /ado-pr-review <pr-url-or-id>")
    else:
        print_error("Could not parse PR id from input")
    raise SystemExit(0)

url_context = parse_url_context(raw_url)
remote_context = detect_context_from_git_remote()

org = url_context.get("org") or remote_context.get("org")
project = url_context.get("project") or remote_context.get("project")
repository_name = url_context.get("repositoryName") or remote_context.get("repositoryName")

env = build_az_devops_env()

warnings = []

try:
    pr = az_pr_show(pr_id, org, project, env)
except Exception as error:
    print_error(f"Failed to fetch PR #{pr_id}. {error}")
    raise SystemExit(0)

repo = pr.get("repository") or {}
repository_id = repo.get("id")
repository_name = repository_name or repo.get("name")

if isinstance(project, str) is False or project == "":
    project = ((repo.get("project") or {}).get("name"))

if isinstance(org, str) is False or org == "":
    org = infer_org_from_pr_url(pr.get("url")) or remote_context.get("org")

if isinstance(repository_id, str) is False or repository_id == "":
    print_error("PR repository id is missing from Azure DevOps response")
    raise SystemExit(0)

if isinstance(project, str) is False or project == "":
    print_error("Could not determine Azure DevOps project for this PR")
    raise SystemExit(0)

try:
    reviewers = az_pr_reviewers(pr_id, org, project, env)
except Exception as error:
    warnings.append(f"Failed to fetch reviewers: {error}")
    reviewers = []

try:
    threads_response = az_invoke_git(
        "pullRequestThreads",
        org,
        {
            "project": project,
            "repositoryId": repository_id,
            "pullRequestId": pr_id,
        },
        {},
        env,
    )
    threads = threads_response.get("value") or []
except Exception as error:
    warnings.append(f"Failed to fetch PR threads: {error}")
    threads = []

try:
    iterations_response = az_invoke_git(
        "pullRequestIterations",
        org,
        {
            "project": project,
            "repositoryId": repository_id,
            "pullRequestId": pr_id,
        },
        {},
        env,
    )
    iterations = iterations_response.get("value") or []
except Exception as error:
    print_error(f"Failed to fetch PR iterations for #{pr_id}. {error}")
    raise SystemExit(0)

if len(iterations) == 0:
    print_error(f"PR #{pr_id} has no iterations; cannot compute changed files")
    raise SystemExit(0)

latest_iteration = max(iterations, key=lambda entry: int(entry.get("id") or 0))
latest_iteration_id = latest_iteration.get("id")

if latest_iteration_id is None:
    print_error(f"Could not determine latest iteration id for PR #{pr_id}")
    raise SystemExit(0)

change_entries = []
skip = 0

while True:
    try:
        changes_response = az_invoke_git(
            "pullRequestIterationChanges",
            org,
            {
                "project": project,
                "repositoryId": repository_id,
                "pullRequestId": pr_id,
                "iterationId": latest_iteration_id,
            },
            {
                "$top": "200",
                "$skip": str(skip),
            },
            env,
        )
    except Exception as error:
        print_error(f"Failed to fetch changed files for PR #{pr_id}. {error}")
        raise SystemExit(0)

    entries = changes_response.get("changeEntries") or []
    change_entries.extend(entries)

    next_skip = changes_response.get("nextSkip")
    if next_skip is None or int(next_skip) <= skip:
        break
    skip = int(next_skip)

changed_files = extract_changed_files(change_entries)

if len(changed_files) == 0:
    print_error(f"No changed files found for PR #{pr_id}")
    raise SystemExit(0)

base_commit = ((pr.get("lastMergeTargetCommit") or {}).get("commitId"))
target_commit = ((pr.get("lastMergeSourceCommit") or {}).get("commitId"))

if isinstance(base_commit, str) is False or base_commit == "":
    print_error(f"PR #{pr_id} is missing base commit id")
    raise SystemExit(0)

if isinstance(target_commit, str) is False or target_commit == "":
    print_error(f"PR #{pr_id} is missing source commit id")
    raise SystemExit(0)

diffs = []
files_for_diff = changed_files[:MAX_DIFF_FILES]
if len(changed_files) > MAX_DIFF_FILES:
    warnings.append(
        f"Changed files exceed diff cap ({MAX_DIFF_FILES}). Diff generated for first {MAX_DIFF_FILES} files only."
    )

for file_entry in files_for_diff:
    path = file_entry["path"]
    change_type = str(file_entry.get("changeType") or "").lower()
    source_path = file_entry.get("originalPath") or path

    before_content = ""
    after_content = ""

    before_error = None
    after_error = None

    if change_type != "add":
        try:
            before_content, before_error = fetch_item_content(
                org,
                project,
                repository_id,
                source_path,
                base_commit,
                env,
            )
            if before_content is None:
                before_content = ""
        except Exception as error:
            before_error = str(error)

    if change_type != "delete":
        try:
            after_content, after_error = fetch_item_content(
                org,
                project,
                repository_id,
                path,
                target_commit,
                env,
            )
            if after_content is None:
                after_content = ""
        except Exception as error:
            after_error = str(error)

    if before_error == "binary" or after_error == "binary":
        diffs.append(
            {
                "path": path,
                "changeType": file_entry.get("changeType"),
                "diff": "<binary file>",
                "truncated": False,
                "contentKind": "binary",
            }
        )
        continue

    if before_error == "binary-or-nontext" or after_error == "binary-or-nontext":
        diffs.append(
            {
                "path": path,
                "changeType": file_entry.get("changeType"),
                "diff": "<non-text content>",
                "truncated": False,
                "contentKind": "non-text",
            }
        )
        continue

    if before_error is not None and before_error not in {"binary", "binary-or-nontext"}:
        warnings.append(f"{path}: could not fetch base content ({before_error})")
    if after_error is not None and after_error not in {"binary", "binary-or-nontext"}:
        warnings.append(f"{path}: could not fetch source content ({after_error})")

    diff_lines = build_unified_diff(path, before_content, after_content)
    diff_lines, truncated = trim_diff_lines(diff_lines)

    if len(diff_lines) == 0:
        diff_text = "<no textual diff available>"
    else:
        diff_text = "\n".join(diff_lines)

    diffs.append(
        {
            "path": path,
            "changeType": file_entry.get("changeType"),
            "originalPath": source_path if source_path != path else None,
            "diff": diff_text,
            "truncated": truncated,
            "contentKind": "text",
        }
    )

if len(diffs) == 0:
    print_error(
        f"Failed to build textual diffs for PR #{pr_id}. Ensure repo files are accessible via Azure DevOps APIs."
    )
    raise SystemExit(0)

payload = {
    "input": raw_input,
    "pullRequestId": int(pr_id),
    "org": org,
    "project": project,
    "repository": {
        "id": repository_id,
        "name": repository_name,
    },
    "pullRequest": pr,
    "reviewers": reviewers,
    "threads": threads,
    "latestIteration": latest_iteration,
    "changes": changed_files,
    "diffs": diffs,
    "limits": {
        "maxChangedFiles": MAX_CHANGED_FILES,
        "maxDiffFiles": MAX_DIFF_FILES,
        "maxFileDiffLines": MAX_FILE_DIFF_LINES,
    },
    "warnings": warnings,
}

print(json.dumps(payload, ensure_ascii=False))
PY
