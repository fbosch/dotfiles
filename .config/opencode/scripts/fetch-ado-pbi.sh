#!/usr/bin/env bash
set -euo pipefail

RAW_INPUT="${1:-}"

python3 - <<'PY' "$RAW_INPUT"
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote, urlparse


def extract_id(value):
    text = value.strip()
    if text.isdigit():
        return text

    patterns = [
        r"/_workitems/edit/(\d+)",
        r"[?&]id=(\d+)",
        r"\b(\d+)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None


def parse_org_and_project(value):
    text = value.strip()
    if text.startswith("http") is False:
        return None, None

    parsed = urlparse(text)
    host = parsed.netloc.lower()
    segments = [unquote(segment) for segment in parsed.path.split("/") if segment]

    if host.endswith("dev.azure.com"):
        if len(segments) >= 2:
            org = segments[0]
            project = segments[1]
            return f"https://dev.azure.com/{org}", project
        return None, None

    if host.endswith("visualstudio.com"):
        if len(segments) >= 1:
            return f"{parsed.scheme}://{parsed.netloc}", segments[0]
        return f"{parsed.scheme}://{parsed.netloc}", None

    return None, None


def detect_org_from_git_remote():
    process = subprocess.run(
        ["git", "config", "--get", "remote.origin.url"],
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        return None

    remote = process.stdout.strip()
    if not remote:
        return None

    dev_azure_match = re.search(r"dev\.azure\.com/([^/]+)/", remote)
    if dev_azure_match:
        return f"https://dev.azure.com/{dev_azure_match.group(1)}"

    visualstudio_match = re.search(r"https://([^.]+)\.visualstudio\.com", remote)
    if visualstudio_match:
        return f"https://{visualstudio_match.group(1)}.visualstudio.com"

    return None


def run_az_work_item_show(item_id, org, project):
    command = ["az", "boards", "work-item", "show", "--id", item_id, "--output", "json"]
    if org:
        command.extend(["--org", org])

    env = dict(os.environ)
    env["AZURE_EXTENSION_USE_DYNAMIC_INSTALL"] = "yes_without_prompt"

    process = subprocess.run(command, capture_output=True, text=True, env=env)
    if process.returncode != 0:
        message = (process.stderr or process.stdout).strip() or "Unknown Azure CLI error"
        raise RuntimeError(message)
    return json.loads(process.stdout)


def extract_task_ids(relations):
    task_ids = []
    for relation in relations or []:
        if relation.get("rel") != "System.LinkTypes.Hierarchy-Forward":
            continue
        url = relation.get("url") or ""
        match = re.search(r"/workItems/(\d+)", url)
        if match:
            task_ids.append(match.group(1))
    return sorted(set(task_ids), key=int)


def collect_wiki_links(relations, source):
    links = []
    for relation in relations or []:
        rel = relation.get("rel") or ""
        url = relation.get("url") or ""
        attributes = relation.get("attributes") or {}
        name = attributes.get("name") or ""
        comment = attributes.get("comment") or ""

        fingerprint = " ".join([rel, url, name, comment]).lower()
        if "wiki" not in fingerprint:
            continue

        links.append(
            {
                "source": source,
                "rel": rel,
                "name": name,
                "comment": comment,
                "url": url,
            }
        )
    return links


def get_current_branch():
    process = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        return ""
    return process.stdout.strip()


def infer_id_from_branch(branch_name):
    if not branch_name:
        return None

    patterns = [
        r"AB#(\d+)",
        r"(?:^|[/-])(?:pbi|wi|workitem|work-item)[-_]?(\d+)(?:$|[/-])",
        r"(?<!\d)(\d{4,})(?!\d)",
    ]
    for pattern in patterns:
        match = re.search(pattern, branch_name, flags=re.IGNORECASE)
        if match:
            return match.group(1)
    return None


raw_input = sys.argv[1] if len(sys.argv) > 1 else ""
if not raw_input.strip():
    branch = get_current_branch()
    inferred_id = infer_id_from_branch(branch)
    if inferred_id is None:
        print("ERROR: Usage: /ado-pbi <pbi-id-or-work-item-url> (or use a branch containing AB#12345 or 12345)")
        raise SystemExit(0)
    raw_input = inferred_id

work_item_id = extract_id(raw_input)
if work_item_id is None:
    print("ERROR: Could not parse work item ID from input")
    raise SystemExit(0)

org, project = parse_org_and_project(raw_input)
if org is None:
    org = detect_org_from_git_remote()

try:
    pbi = run_az_work_item_show(work_item_id, org, project)
except Exception as error:
    print(f"ERROR: Failed to fetch PBI #{work_item_id}. {error}")
    raise SystemExit(0)

task_ids = extract_task_ids(pbi.get("relations") or [])
tasks = []
errors = []
wiki_links = collect_wiki_links(pbi.get("relations") or [], "pbi")

for task_id in task_ids:
    try:
        task = run_az_work_item_show(task_id, org, project)
        tasks.append(task)
        wiki_links.extend(collect_wiki_links(task.get("relations") or [], f"task:{task_id}"))
    except Exception as error:
        errors.append({"taskId": task_id, "error": str(error)})

seen = set()
deduped_wiki_links = []
for entry in wiki_links:
    key = (entry.get("source"), entry.get("url"), entry.get("rel"), entry.get("name"))
    if key in seen:
        continue
    seen.add(key)
    deduped_wiki_links.append(entry)

payload = {
    "input": raw_input,
    "workItemId": work_item_id,
    "org": org,
    "project": project,
    "pbi": pbi,
    "tasks": tasks,
    "taskErrors": errors,
    "wikiLinks": deduped_wiki_links,
}

print(json.dumps(payload, ensure_ascii=False))
PY
