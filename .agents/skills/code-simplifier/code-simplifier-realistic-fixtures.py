#!/usr/bin/env python3
"""Materialize isolated, hash-checked snapshots for the realistic simplifier eval."""
from __future__ import annotations

import difflib
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAPSHOT_ROOT = HERE / "realistic-snapshots"
MANIFEST = HERE / "realistic-snapshots.json"
OWNER = ".caliper-owner"
BASELINE = ".caliper-baseline"
ARTIFACT_ROOT = Path("/tmp/code-simplifier-realistic-artifacts")

TASKS = {
    "just": {
        "root": Path("/tmp/code-simplifier-realistic-just"),
        "sources": [".pi/agent/extensions/just/catalog.ts"],
        "source_dir": ".pi/agent/extensions/just",
        "test": ".pi/agent/extensions/just/__tests__/catalog.test.ts",
        "deps": True,
    },
    "handoff": {
        "root": Path("/tmp/code-simplifier-realistic-handoff"),
        "sources": [
            ".pi/agent/extensions/handoff/context.ts",
            ".pi/agent/extensions/handoff/index.ts",
        ],
        "source_dir": ".pi/agent/extensions/handoff",
        "test": ".pi/agent/extensions/handoff/__tests__/handoff.test.ts",
        "deps": True,
    },
    "typo-engine": {
        "root": Path("/tmp/code-simplifier-realistic-typo-engine"),
        "sources": [
            ".config/opencode/plugins/prompt-enhancements/typo-engine.ts",
        ],
        "source_dir": ".config/opencode/plugins/prompt-enhancements",
        "test": ".config/opencode/plugins/prompt-enhancements/__tests__/typo-engine.test.ts",
        "runner": ".test-runner.sh",
        "deps": False,
    },
}


def owner_value(name: str) -> str:
    return f"code-simplifier-realistic-{name}\n"


def load_manifest() -> dict:
    data = json.loads(MANIFEST.read_text())
    for task, entries in data["files"].items():
        for rel, expected in entries.items():
            path = SNAPSHOT_ROOT / task / rel
            if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise SystemExit(f"frozen snapshot hash mismatch: {task}/{rel}")
    return data


def target_rel(snapshot_rel: str) -> str:
    suffix = ".snapshot"
    return snapshot_rel[: -len(suffix)] if snapshot_rel.endswith(suffix) else snapshot_rel


def assert_absent_or_owned(root: Path, name: str) -> None:
    if not root.exists() and not root.is_symlink():
        return
    if root.is_symlink() or not root.is_dir():
        raise SystemExit(f"refusing unexpected fixture path: {root}")
    marker = root / OWNER
    if marker.is_symlink() or not marker.is_file() or marker.read_text() != owner_value(name):
        raise SystemExit(f"refusing to touch unowned fixture: {root}")
    raise SystemExit(f"fixture already exists; clean it before creating: {root}")


def copy_dependencies(staging: Path) -> None:
    # Bun resolves the symlinked repository install without copying its large tree.
    source = Path(__file__).resolve().parents[3] / ".pi/agent/node_modules"
    if not source.is_dir():
        raise SystemExit(f"dependency tree is unavailable: {source}")
    target = staging / ".pi/agent/node_modules"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(source, target_is_directory=True)


def make_readonly(path: Path) -> None:
    for child in sorted(path.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if child.is_symlink():
            continue
        try:
            mode = child.stat().st_mode
            child.chmod(mode & ~0o222)
        except FileNotFoundError:
            pass
    path.chmod(path.stat().st_mode & ~0o222)


def make_source_writable(staging: Path, config: dict) -> None:
    source_dir = staging / config["source_dir"]
    source_dir.mkdir(parents=True, exist_ok=True)
    for parent in [source_dir, *source_dir.parents]:
        if parent == staging.parent:
            break
        try:
            parent.chmod(parent.stat().st_mode | 0o700)
        except FileNotFoundError:
            pass
    for rel in config["sources"]:
        path = staging / rel
        path.chmod(path.stat().st_mode | 0o600)


def create(name: str) -> None:
    if name not in TASKS:
        raise SystemExit(f"unknown task: {name}")
    config = TASKS[name]
    root = config["root"]
    assert_absent_or_owned(root, name)
    manifest = load_manifest()
    snapshot_files = manifest["files"].get(name, {})
    if not snapshot_files:
        raise SystemExit(f"no frozen snapshots registered for {name}")

    staging = Path(tempfile.mkdtemp(prefix=f".code-simplifier-{name}-", dir="/tmp"))
    try:
        for snapshot_rel in snapshot_files:
            source = SNAPSHOT_ROOT / name / snapshot_rel
            target = staging / target_rel(snapshot_rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        baseline = staging / BASELINE
        for snapshot_rel in snapshot_files:
            source = SNAPSHOT_ROOT / name / snapshot_rel
            target = baseline / target_rel(snapshot_rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        (baseline / OWNER).write_text(owner_value(f"{name}-baseline"))
        if config["deps"]:
            copy_dependencies(staging)
        (staging / OWNER).write_text(owner_value(name))
        make_readonly(baseline)
        make_readonly(staging)
        if "runner" in config:
            (staging / config["runner"]).chmod(0o555)
        make_source_writable(staging, config)
        root.parent.mkdir(parents=True, exist_ok=True)
        os.replace(staging, root)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def files_under(root: Path) -> set[str]:
    result = set()
    for path in root.rglob("*"):
        if path.is_file() and BASELINE not in path.parts and "node_modules" not in path.parts:
            result.add(str(path.relative_to(root)))
    return result


def verify(name: str) -> dict:
    config = TASKS[name]
    root = config["root"]
    if not root.is_dir() or root.is_symlink() or (root / OWNER).read_text() != owner_value(name):
        raise SystemExit(f"fixture is missing or unowned: {root}")
    baseline = root / BASELINE
    if not baseline.is_dir() or (baseline / OWNER).read_text() != owner_value(f"{name}-baseline"):
        raise SystemExit("baseline is missing or unowned")

    manifest = load_manifest()
    expected_snapshot = {
        target_rel(rel): digest for rel, digest in manifest["files"][name].items()
    }
    for rel, digest in expected_snapshot.items():
        if not (baseline / rel).is_file() or hashlib.sha256((baseline / rel).read_bytes()).hexdigest() != digest:
            raise SystemExit(f"protected baseline changed: {rel}")
    expected = {str(p.relative_to(baseline)) for p in baseline.rglob("*") if p.is_file() and p.name != OWNER}
    actual = files_under(root) - {OWNER}
    missing = sorted(expected - actual)
    extras = sorted(actual - expected)
    allowed_extra_prefix = config["source_dir"] + "/"
    bad_extras = [
        p
        for p in extras
        if not p.startswith(allowed_extra_prefix)
        or "/__tests__/" in p
        or p.endswith((".json", ".yaml", ".yml", ".toml", ".lock"))
    ]
    protected = []
    changed = []
    for rel in sorted(expected):
        before = baseline / rel
        after = root / rel
        if not after.is_file():
            continue
        if hashlib.sha256(before.read_bytes()).hexdigest() != hashlib.sha256(after.read_bytes()).hexdigest():
            changed.append(rel)
            if rel not in config["sources"]:
                protected.append(rel)
    if missing or bad_extras or protected:
        raise SystemExit(json.dumps({"missing": missing, "unexpected": bad_extras, "protected_changed": protected}))

    command = [f"./{config['runner']}"] if "runner" in config else ["bun", "test", f"./{config['test']}"]
    with tempfile.TemporaryDirectory(prefix=f"code-simplifier-{name}-home-") as isolated:
        isolated_home = Path(isolated) / "home"
        isolated_agent = Path(isolated) / "agent"
        isolated_home.mkdir()
        isolated_agent.mkdir()
        test_env = os.environ.copy()
        test_env.update({"HOME": str(isolated_home), "PI_CODING_AGENT_DIR": str(isolated_agent)})
        result = subprocess.run(
            command,
            cwd=root,
            env=test_env,
            capture_output=True,
            text=True,
            timeout=60,
        )
    report = {
        "task": name,
        "snapshot_revision": load_manifest()["snapshot_git_revision"],
        "test_command": command,
        "test_returncode": result.returncode,
        "test_stdout": result.stdout[-4000:],
        "test_stderr": result.stderr[-4000:],
        "changed_paths": changed,
        "allowed_extra_paths": extras,
    }
    if result.returncode != 0:
        raise SystemExit(json.dumps(report))
    return report


def record_and_clean(name: str) -> None:
    config = TASKS[name]
    root = config["root"]
    if not root.is_dir() or root.is_symlink() or (root / OWNER).read_text() != owner_value(name):
        raise SystemExit(f"refusing to remove unowned fixture: {root}")
    baseline = root / BASELINE
    paths = sorted(set(files_under(root)) | {str(p.relative_to(baseline)) for p in baseline.rglob("*") if p.is_file() and p.name != OWNER})
    diff: list[str] = []
    changed_paths: list[str] = []
    for rel in paths:
        before = (baseline / rel).read_text(errors="replace").splitlines(keepends=True) if (baseline / rel).is_file() else []
        after = (root / rel).read_text(errors="replace").splitlines(keepends=True) if (root / rel).is_file() else []
        if before != after:
            changed_paths.append(rel)
            diff.extend(difflib.unified_diff(before, after, fromfile=f"before/{rel}", tofile=f"after/{rel}"))
    ARTIFACT_ROOT.mkdir(mode=0o700, exist_ok=True)
    artifact = ARTIFACT_ROOT / f"{name}-{time.time_ns()}"
    artifact.mkdir(mode=0o700)
    (artifact / "diff.patch").write_text("".join(diff))
    (artifact / "report.json").write_text(json.dumps({"task": name, "changed": changed_paths}, indent=2) + "\n")
    for child in root.rglob("*"):
        if child.is_symlink():
            continue
        try:
            child.chmod(child.stat().st_mode | 0o700)
        except FileNotFoundError:
            pass
    root.chmod(root.stat().st_mode | 0o700)
    shutil.rmtree(root)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"create", "verify", "clean"} or sys.argv[2] not in TASKS:
        raise SystemExit("usage: code-simplifier-realistic-fixtures.py create|verify|clean TASK")
    load_manifest()
    result = {"create": create, "verify": verify, "clean": record_and_clean}[sys.argv[1]](sys.argv[2])
    if isinstance(result, dict):
        print(json.dumps(result))


if __name__ == "__main__":
    main()
