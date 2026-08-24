#!/usr/bin/env python3

import argparse
import base64
import subprocess
import tempfile
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract an importable JavaScript module from an AGS bundle",
    )
    parser.add_argument("--gtk", type=int, default=4)
    parser.add_argument("entrypoint", type=Path)
    parser.add_argument("output", type=Path)
    return parser.parse_args()


def extract_javascript(wrapper):
    lines = wrapper.read_text(encoding="utf-8").splitlines()
    marker = "base64 --decode > $file"
    try:
        start = next(index for index, line in enumerate(lines) if marker in line) + 1
        end = lines.index("EOF", start)
    except (StopIteration, ValueError) as error:
        raise RuntimeError("AGS bundle wrapper did not contain a JavaScript payload") from error

    try:
        return base64.b64decode("".join(lines[start:end]), validate=True)
    except ValueError as error:
        raise RuntimeError("AGS bundle wrapper contained invalid base64") from error


def main():
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix=f".{args.output.name}.",
        dir=args.output.parent,
        delete=False,
    ) as temporary:
        wrapper = Path(temporary.name)
    try:
        subprocess.run(
            ["ags", "bundle", "--gtk", str(args.gtk), str(args.entrypoint), str(wrapper)],
            check=True,
        )
        args.output.write_bytes(extract_javascript(wrapper))
    finally:
        wrapper.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
