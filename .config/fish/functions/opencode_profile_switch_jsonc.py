#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def strip_comments(text: str) -> str:
    out: list[str] = []
    i = 0
    length = len(text)
    in_string = False
    escaped = False

    while i < length:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < length else ""

        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue

        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue

        if ch == "/" and nxt == "/":
            i += 2
            while i < length and text[i] != "\n":
                i += 1
            continue

        if ch == "/" and nxt == "*":
            i += 2
            while i + 1 < length and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def strip_trailing_commas(text: str) -> str:
    out: list[str] = []
    i = 0
    length = len(text)
    in_string = False
    escaped = False

    while i < length:
        ch = text[i]

        if in_string:
            out.append(ch)
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            i += 1
            continue

        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue

        if ch == ",":
            j = i + 1
            while j < length and text[j] in " \t\r\n":
                j += 1
            if j < length and text[j] in "}]":
                i += 1
                continue

        out.append(ch)
        i += 1

    return "".join(out)


def main() -> int:
    if len(sys.argv) != 3:
        return 2

    source_path = Path(sys.argv[1])
    target_path = Path(sys.argv[2])
    raw = source_path.read_text(encoding="utf-8")
    normalized = strip_trailing_commas(strip_comments(raw))
    parsed = json.loads(normalized)
    target_path.write_text(json.dumps(parsed), encoding="utf-8")
    return 0


raise SystemExit(main())
