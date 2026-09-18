#!/usr/bin/env python3
"""Create and remove the private stdlib-only fixtures used by the eval spec.

This helper only owns fixture setup; grading assertions stay in the eval spec.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import textwrap
from pathlib import Path


OWNER = ".caliper-owner"
ROOTS = {
    "already-clear": Path("/tmp/code-simplifier-eval-already-clear"),
    "lifecycle": Path("/tmp/code-simplifier-eval-lifecycle"),
    "async": Path("/tmp/code-simplifier-eval-async"),
    "policies": Path("/tmp/code-simplifier-eval-policies"),
    "scope": Path("/tmp/code-simplifier-eval-scope"),
}


ALREADY_CLEAR = textwrap.dedent(
    '''\
    from pathlib import Path


    def read_setting(path: Path, default: str) -> str:
        if not path.exists():
            return default

        value = path.read_text(encoding="utf-8").strip()
        if not value:
            return default
        return value
    '''
)

ALREADY_CLEAR_TEST = textwrap.dedent(
    '''\
    from pathlib import Path
    from tempfile import TemporaryDirectory

    from already_clear import read_setting


    with TemporaryDirectory() as directory:
        path = Path(directory) / "setting.txt"
        assert read_setting(path, "fallback") == "fallback"
        path.write_text("  ready  \\n", encoding="utf-8")
        assert read_setting(path, "fallback") == "ready"
    '''
)

LIFECYCLE = textwrap.dedent(
    '''\
    from __future__ import annotations

    from typing import Callable


    class Session:
        def __init__(self, events: list[str]) -> None:
            self.events = events
            self.closed = False
            self.events.append("open")

        def close(self) -> None:
            if self.closed:
                return
            self.closed = True
            self.events.append("close")


    def _with_session(
        work: Callable[[Session], str], events: list[str]
    ) -> str:
        session = Session(events)
        try:
            return work(session)
        except Exception:
            events.append("error")
            raise
        finally:
            session.close()


    def _work(session: Session, mode: str) -> str:
        session.events.append("work")
        if mode == "error":
            raise ValueError("boom")
        return "done"


    def run_once(mode: str) -> dict[str, object]:
        events: list[str] = []
        try:
            value = _with_session(lambda session: _work(session, mode), events)
        except ValueError as error:
            return {"status": "error", "value": str(error), "events": events}
        return {"status": "ok", "value": value, "events": events}
    '''
)

LIFECYCLE_TEST = textwrap.dedent(
    '''\
    from lifecycle import run_once


    assert run_once("success") == {
        "status": "ok", "value": "done", "events": ["open", "work", "close"]
    }
    assert run_once("error") == {
        "status": "error", "value": "boom", "events": ["open", "work", "error", "close"]
    }
    '''
)

ASYNC_PIPELINE = textwrap.dedent(
    '''\
    import asyncio


    async def _open(events: list[str]) -> dict[str, list[str]]:
        events.append("open")
        await asyncio.sleep(0)
        return {"events": events}


    async def _step(resource: dict[str, list[str]], mode: str) -> str:
        events = resource["events"]
        events.append("step:start")
        await asyncio.sleep(0)
        if mode == "error":
            events.append("step:error")
            raise ValueError("boom")
        if mode == "cancel":
            events.append("step:cancel")
            raise asyncio.CancelledError
        events.append("step:done")
        return "value"


    async def _close(resource: dict[str, list[str]]) -> None:
        events = resource["events"]
        events.append("close:start")
        await asyncio.sleep(0)
        events.append("close:done")


    async def run(mode: str, events: list[str]) -> str:
        resource: dict[str, list[str]] | None = None
        try:
            resource = await _open(events)
            try:
                try:
                    result = await _step(resource, mode)
                except asyncio.CancelledError:
                    events.append("cancel")
                    raise
                except ValueError as error:
                    events.append("error")
                    return "error:" + str(error)
                else:
                    events.append("success")
                    return result
            finally:
                if resource is not None:
                    await _close(resource)
                    events.append("cleanup")
        except BaseException:
            raise


    def execute(mode: str) -> dict[str, object]:
        events: list[str] = []
        try:
            value = asyncio.run(run(mode, events))
        except asyncio.CancelledError:
            return {"status": "cancelled", "value": None, "events": events}
        return {"status": "ok", "value": value, "events": events}
    '''
)

ASYNC_TEST = textwrap.dedent(
    '''\
    from async_pipeline import execute


    assert execute("success")["status"] == "ok"
    assert execute("error")["value"] == "error:boom"
    assert execute("cancel")["status"] == "cancelled"
    '''
)

POLICIES = textwrap.dedent(
    '''\
    def _record(events: list[str], policy: str, decision: str) -> None:
        events.append(f"{policy}:{decision}")


    # Primary routing belongs to the fast-path policy owner; its rules evolve independently.
    def primary_policy(item: dict[str, object], events: list[str]) -> str:
        if item["kind"] == "urgent":
            decision = "expedite"
        elif item["retryable"]:
            decision = "retry"
        else:
            decision = "queue"
        _record(events, "primary", decision)
        return decision


    # Secondary routing belongs to the review policy owner; similar inputs do not imply shared rules.
    def secondary_policy(item: dict[str, object], events: list[str]) -> str:
        if item["kind"] == "urgent":
            decision = "review"
        elif item["retryable"]:
            decision = "hold"
        else:
            decision = "archive"
        _record(events, "secondary", decision)
        return decision


    def decide(item: dict[str, object]) -> dict[str, object]:
        events: list[str] = []
        primary = primary_policy(item, events)
        secondary = secondary_policy(item, events)
        return {"primary": primary, "secondary": secondary, "events": events}
    '''
)

POLICIES_TEST = textwrap.dedent(
    '''\
    from policies import decide


    assert decide({"kind": "urgent", "retryable": True})["primary"] == "expedite"
    assert decide({"kind": "urgent", "retryable": True})["secondary"] == "review"
    assert decide({"kind": "normal", "retryable": True})["primary"] == "retry"
    assert decide({"kind": "normal", "retryable": True})["secondary"] == "hold"
    assert decide({"kind": "normal", "retryable": False})["primary"] == "queue"
    assert decide({"kind": "normal", "retryable": False})["secondary"] == "archive"
    '''
)

SCOPE_BASELINE = textwrap.dedent(
    '''\
    def format_message(name: str, excited: bool) -> str:
        cleaned = name.strip()
        if cleaned:
            if excited:
                return f"Hello, {cleaned}!"
            return f"Hello, {cleaned}."
        if excited:
            return "Hello, guest!"
        return "Hello, guest."
    '''
)

SCOPE_CURRENT = textwrap.dedent(
    '''\
    def format_message(name: str, excited: bool) -> str:
        cleaned = name.strip()
        if cleaned:
            if excited:
                message = f"Hello, {cleaned}!"
            else:
                message = f"Hello, {cleaned}."
        else:
            if excited:
                message = "Hello, guest!"
            else:
                message = "Hello, guest."
        return message
    '''
)

SCOPE_UNRELATED_BASELINE = textwrap.dedent(
    '''\
    # Existing notes are maintained by another workstream.
    NOTES = ["keep", "the", "draft"]
    '''
)

SCOPE_UNRELATED_CHANGED = textwrap.dedent(
    '''\
    # Existing notes are maintained by another workstream.
    NOTES = ["keep", "the", "draft", "and", "this", "new", "entry"]
    '''
)

SCOPE_DOC = textwrap.dedent(
    '''\
    # Validation notes

    The focused check `python3 -m unittest tests/test_current.py` is documented
    for the full project, but that test file is not present in this small fixture.
    The available fixture check is:

        python3 -m unittest test_current.py

    The stdlib syntax fallback is:

        python3 -m py_compile src/current.py

    The `src/current.py` edit is the current-session cleanup. The changed
    `notes/unrelated.py` file predates this session and must remain byte-for-byte
    unchanged.
    '''
)

SCOPE_TEST = textwrap.dedent(
    '''\
    from src.current import format_message


    assert format_message("", True) == "Hello, guest!"
    assert format_message("  Ada  ", True) == "Hello, Ada!"
    assert format_message("  Ada  ", False) == "Hello, Ada."
    '''
)


def _owner_value(name: str) -> str:
    return f"code-simplifier-{name}\n"


def _assert_new_root(root: Path, name: str) -> None:
    if root.is_symlink() or (root.exists() and not root.is_dir()):
        raise SystemExit(f"refusing unexpected fixture path: {root}")
    if root.exists():
        owner = root / OWNER
        if owner.is_symlink() or not owner.is_file() or owner.read_text() != _owner_value(name):
            raise SystemExit(f"refusing to remove unowned fixture: {root}")
        raise SystemExit(f"fixture already exists; refusing concurrent run: {root}")
    root.mkdir(mode=0o700)
    (root / OWNER).write_text(_owner_value(name))


def _remove_root(root: Path, name: str) -> None:
    if not root.exists():
        if root.is_symlink():
            raise SystemExit(f"refusing unexpected fixture path: {root}")
        return
    if root.is_symlink() or not root.is_dir():
        raise SystemExit(f"refusing unexpected fixture path: {root}")
    owner = root / OWNER
    if owner.is_symlink() or not owner.is_file() or owner.read_text() != _owner_value(name):
        raise SystemExit(f"refusing to remove unowned fixture: {root}")
    shutil.rmtree(root)


def _write(root: Path, name: str, content: str, executable: bool = False) -> None:
    path = root / name
    path.write_text(content)
    if executable:
        path.chmod(0o755)


def _create_already_clear(root: Path) -> None:
    _assert_new_root(root, "already-clear")
    _write(root, "already_clear.py", ALREADY_CLEAR)
    _write(root, "test_already_clear.py", ALREADY_CLEAR_TEST)


def _create_lifecycle(root: Path) -> None:
    _assert_new_root(root, "lifecycle")
    _write(root, "lifecycle.py", LIFECYCLE)
    _write(root, "test_lifecycle.py", LIFECYCLE_TEST)


def _create_async(root: Path) -> None:
    _assert_new_root(root, "async")
    _write(root, "async_pipeline.py", ASYNC_PIPELINE)
    _write(root, "test_async_pipeline.py", ASYNC_TEST)


def _create_policies(root: Path) -> None:
    _assert_new_root(root, "policies")
    _write(root, "policies.py", POLICIES)
    _write(root, "test_policies.py", POLICIES_TEST)


def _run_git(*args: str, cwd: Path) -> None:
    try:
        subprocess.run(
            ["git", *args],
            cwd=cwd,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
        )
    except FileNotFoundError as error:
        raise SystemExit("scope fixture requires git for its worktree state") from error
    except subprocess.TimeoutExpired as error:
        raise SystemExit("scope fixture git setup exceeded its deadline") from error


def _create_scope(root: Path) -> None:
    _assert_new_root(root, "scope")
    (root / "src").mkdir()
    (root / "notes").mkdir()
    _write(root, "src/current.py", SCOPE_BASELINE)
    _write(root, "notes/unrelated.py", SCOPE_UNRELATED_BASELINE)
    _write(root, "VALIDATION.md", SCOPE_DOC)
    _write(root, "test_current.py", SCOPE_TEST)
    _run_git("init", "-q", cwd=root)
    _run_git("config", "user.email", "eval@example.invalid", cwd=root)
    _run_git("config", "user.name", "Caliper Fixture", cwd=root)
    _run_git("add", "src/current.py", "notes/unrelated.py", "VALIDATION.md", "test_current.py", cwd=root)
    _run_git("commit", "-qm", "fixture baseline", cwd=root)
    _write(root, "src/current.py", SCOPE_CURRENT)
    _write(root, "notes/unrelated.py", SCOPE_UNRELATED_CHANGED)


def create(name: str) -> None:
    root = ROOTS[name]
    {
        "already-clear": _create_already_clear,
        "lifecycle": _create_lifecycle,
        "async": _create_async,
        "policies": _create_policies,
        "scope": _create_scope,
    }[name](root)


def clean(name: str) -> None:
    _remove_root(ROOTS[name], name)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in {"create", "clean"} or sys.argv[2] not in ROOTS:
        raise SystemExit("usage: code-simplifier-fixtures.py create|clean TASK")
    (create if sys.argv[1] == "create" else clean)(sys.argv[2])
