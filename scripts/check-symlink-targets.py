#!/usr/bin/env python3

from __future__ import annotations

import fnmatch
import os
import subprocess
import sys
from pathlib import Path

ALLOWLIST_PATHS = [
    ".config/ags/docs/agents/guide",
    ".config/glance/docs/agents/references",
    ".config/hypr/docs/agents/references",
    ".config/vicinae/extensions/docs/agents/references",
    ".config/gtk-4.0/assets",
    ".config/gtk-4.0/gtk.css",
    ".config/gtk-4.0/gtk-dark.css",
]


def git(*args: str, cwd: Path) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True)


def is_allowlisted(path: str) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in ALLOWLIST_PATHS)


def resolve_target(repo_root: Path, symlink_path: str, target: str) -> Path:
    if os.path.isabs(target):
        return Path(target)
    return (repo_root / Path(symlink_path).parent / target).resolve()


def main() -> int:
    repo_root = Path(git("rev-parse", "--show-toplevel", cwd=Path.cwd()).strip())
    index = git("ls-files", "-s", cwd=repo_root)

    failures: list[str] = []
    checked = 0

    for line in index.splitlines():
        mode, _hash, _stage, path = line.split(maxsplit=3)
        if mode != "120000":
            continue

        if is_allowlisted(path):
            continue

        target = git("show", f"HEAD:{path}", cwd=repo_root).strip()
        resolved = resolve_target(repo_root, path, target)
        checked += 1

        if not resolved.exists():
            failures.append(
                f"{path} -> {target} (resolved: {resolved})"
            )

    if failures:
        print("Broken tracked symlink targets detected:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print(f"Symlink target check passed ({checked} symlinks validated).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
