#!/usr/bin/env python3
import json
import re
import subprocess
import sys


def run(cmd):
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        return ""
    return process.stdout


def parse_name_status(diff_name_status):
    status = {}
    for line in diff_name_status.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        code = parts[0]
        if code.startswith("R") and len(parts) >= 3:
            old_path = parts[1]
            new_path = parts[2]
            status[old_path] = ("R", new_path)
            continue
        path = parts[1]
        status[path] = (code, None)
    return status


def parse_added_lines(unified_diff):
    files = {}
    current_file = None
    current_line = 0

    for raw in unified_diff.splitlines():
        line = raw.rstrip("\n")
        if line.startswith("+++ b/"):
            current_file = line[6:]
            files.setdefault(current_file, [])
            continue

        if line.startswith("@@"):
            match = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if match is None:
                current_line = 0
                continue
            current_line = int(match.group(1))
            continue

        if current_file is None:
            continue

        if line.startswith("+") and line.startswith("+++") is False:
            files[current_file].append((current_line, line[1:]))
            current_line += 1
            continue

        if line.startswith("-") and line.startswith("---") is False:
            continue

        current_line += 1

    return files


def extract_backticked_tokens(text):
    tokens = set()
    for token in re.findall(r"`([^`]+)`", text):
        cleaned = token.strip()
        if len(cleaned) < 3:
            continue
        if " " in cleaned:
            continue
        tokens.add(cleaned)
    return sorted(tokens)


def build_resolution_note(item, reason):
    return (
        f"Addressed in local changes for `{item['pathLine']}`. "
        f"Reason: {reason}. "
        "If this does not fully satisfy the request, reopen and I will follow up."
    )


def main():
    raw = sys.stdin.read().strip()
    if raw.startswith("ERROR:"):
        print(raw)
        return

    if raw == "":
        print("ERROR: Empty normalized review input")
        return

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"ERROR: Invalid normalized review JSON: {error}")
        return

    threads = payload.get("threads", [])
    if isinstance(threads, list) is False:
        print("ERROR: Normalized payload missing threads array")
        return

    name_status = parse_name_status(run(["git", "diff", "--name-status"]))
    added_lines = parse_added_lines(run(["git", "diff", "--unified=0", "--no-color"]))

    proposed_resolve = []
    proposed_irrelevant = []
    keep_open = []

    for item in threads:
        path = item.get("path") or "unknown"
        path_status = name_status.get(path)

        if item.get("isOutdated") is True:
            if path_status is not None and path_status[0] == "D":
                reason = "thread is outdated and file was deleted"
                proposed_irrelevant.append(
                    {
                        **item,
                        "reason": reason,
                        "confidence": "high",
                        "resolutionNote": build_resolution_note(item, reason),
                    }
                )
                continue

            if path_status is not None and path_status[0].startswith("R"):
                reason = f"thread is outdated and file was renamed to {path_status[1]}"
                proposed_irrelevant.append(
                    {
                        **item,
                        "reason": reason,
                        "confidence": "medium",
                        "resolutionNote": build_resolution_note(item, reason),
                    }
                )
                continue

        line = item.get("line") if isinstance(item.get("line"), int) else None
        tokens = extract_backticked_tokens(item.get("actionableText") or "")
        file_additions = added_lines.get(path, [])

        token_match = False
        near_match = False
        if len(tokens) > 0 and len(file_additions) > 0:
            for added_line_no, added_text in file_additions:
                if line is not None and abs(added_line_no - line) <= 80:
                    near_match = True
                for token in tokens:
                    if token in added_text:
                        token_match = True
                if token_match and near_match:
                    break

        if token_match and near_match:
            reason = "matching symbol/token appears in nearby added lines"
            proposed_resolve.append(
                {
                    **item,
                    "reason": reason,
                    "confidence": "medium",
                    "resolutionNote": build_resolution_note(item, reason),
                }
            )
            continue

        keep_open.append(
            {
                **item,
                "reason": "No strong evidence yet that requested behavior was addressed",
                "confidence": "high",
            }
        )

    output = {
        **payload,
        "proposedResolve": proposed_resolve,
        "proposedIrrelevant": proposed_irrelevant,
        "keepOpen": keep_open,
    }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
