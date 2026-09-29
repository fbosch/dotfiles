#!/usr/bin/env python3
"""Warn about stock phrases and jargon in explicit Markdown and text files."""

import argparse
import re
import sys
from pathlib import Path

STOCK_PHRASES = (
    ("announcement opener", r"here's\s+the\s+thing"),
    ("announcement opener", r"let\s+me\s+be\s+clear"),
    ("announcement opener", r"the\s+truth\s+is"),
    ("performative emphasis", r"full\s+stop"),
    ("performative emphasis", r"let\s+that\s+sink\s+in"),
    ("performative emphasis", r"make\s+no\s+mistake"),
    ("meta-commentary", r"plot\s+twist"),
    ("meta-commentary", r"let\s+me\s+walk\s+you\s+through"),
    ("meta-commentary", r"as\s+we'll\s+see"),
    ("business jargon", r"lean\s+into"),
    ("business jargon", r"double\s+down"),
    ("business jargon", r"circle\s+back"),
    ("business jargon", r"deep\s+dive"),
)
JARGON = (
    "substrate", "wedge", "vector", "locus", "vantage", "nexus", "primitive",
    "harness", "surface", "bedrock", "scaffolding", "modality", "paradigm",
    "gold-plating", "ratchet", "evacuate", "endgame", "north star", "flywheel",
)
PATTERNS = tuple(
    (rule, re.compile(rf"(?<!\w){phrase}(?!\w)", re.IGNORECASE))
    for rule, phrase in STOCK_PHRASES
) + tuple(
    ("jargon", re.compile(rf"(?<!\w){re.escape(term)}(?!\w)", re.IGNORECASE))
    for term in JARGON
)
FENCE_START = re.compile(r"^ {0,3}(`{3,}|~{3,})")
FENCE_END = re.compile(r"^ {0,3}(`+|~+)[ \t]*$")


def _mask_inline_code(line):
    """Mask same-line code spans without rescanning unequal delimiter runs."""
    runs = []
    position = 0
    while position < len(line):
        if line[position] != "`":
            position += 1
            continue

        start = position
        while position < len(line) and line[position] == "`":
            position += 1
        runs.append((start, position, position - start))

    # Indexing nearest later runs preserves the regex's lazy closer without rescanning.
    next_same = [None] * len(runs)
    nearest_by_length = {}
    for index in range(len(runs) - 1, -1, -1):
        length = runs[index][2]
        next_same[index] = nearest_by_length.get(length)
        nearest_by_length[length] = index

    masked = list(line)
    index = 0
    while index < len(runs):
        closing_index = next_same[index]
        if closing_index is None:
            index += 1
            continue

        start = runs[index][0]
        end = runs[closing_index][1]
        masked[start:end] = " " * (end - start)
        index = closing_index + 1

    return "".join(masked)


def prose_lines(text):
    """Yield source lines outside bounded fenced and same-line inline code."""
    fence_char = None
    fence_length = 0

    for number, line in enumerate(text.splitlines(), start=1):
        if fence_char is not None:
            closing = FENCE_END.match(line)
            if (
                closing
                and closing.group(1)[0] == fence_char
                and len(closing.group(1)) >= fence_length
            ):
                fence_char = None
                fence_length = 0
            continue

        opening = FENCE_START.match(line)
        if opening:
            fence_char = opening.group(1)[0]
            fence_length = len(opening.group(1))
            continue

        yield number, _mask_inline_code(line)


def findings(text):
    """Yield (line number, rule, matched text, source line) warnings."""
    for number, line in prose_lines(text):
        for rule, pattern in PATTERNS:
            for match in pattern.finditer(line):
                yield number, rule, match.group(), line.strip()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="+",
        type=Path,
        help="Markdown or plain-text files to check; pass targets explicitly",
    )
    args = parser.parse_args(argv)

    total = 0
    for path in args.paths:
        if not path.is_file():
            print(f"check-prose: not a file: {path}", file=sys.stderr)
            return 2
        if path.suffix.lower() not in {".md", ".txt"}:
            print(f"check-prose: unsupported file type: {path}", file=sys.stderr)
            return 2

        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            print(f"check-prose: cannot read {path}: {error}", file=sys.stderr)
            return 2

        for number, rule, matched, line in findings(text):
            print(f"{path}:{number}: {rule}: {matched}\n    {line}")
            total += 1

    if total:
        print(f"\n{total} warning(s)", file=sys.stderr)
    else:
        print(f"{len(args.paths)} file(s) checked, no warnings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
