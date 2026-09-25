#!/usr/bin/env python3
"""Create and verify isolated stdlib fixtures for the test-pruner eval."""

import ast
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CASES = {"duplicate", "boundary", "regression"}
ROOT = Path("/tmp")

COMMON = {
    "AGENTS.md": """# Fixture instructions

- Audit every unit test under `tests/`, including `checks.py` when present.
- Run `python3 -m unittest discover -s tests -p '*.py'` for the baseline and after edits.
- Keep production behavior unchanged. Do not add dependencies or access the network.
""",
}

FILES = {
    "duplicate": {
        "labels.py": """def normalize_label(value: str) -> str:
    \"\"\"Strip outer whitespace and lowercase labels; preserve inner spaces.\"\"\"
    return value.strip().lower()
""",
        "tests/test_labels.py": """import unittest
from labels import normalize_label


class LabelTests(unittest.TestCase):
    def test_strips_and_lowercases(self):
        self.assertEqual(normalize_label("  READY  "), "ready")

    def test_same_behavior_without_an_oracle(self):
        self.assertEqual(normalize_label("  READY  "), normalize_label("  READY  "))

    def test_empty(self):
        self.assertEqual(normalize_label("  "), "")
""",
        "tests/checks.py": """import unittest
from labels import normalize_label


class AdditionalChecks(unittest.TestCase):
    def test_preserves_inner_space(self):
        self.assertEqual(normalize_label(" A  B "), "a  b")
""",
    },
    "boundary": {
        "pages.py": """def validate_page_size(size: int) -> int:
    \"\"\"Accept integral page sizes from 1 through 100 inclusive.\"\"\"
    if not isinstance(size, int) or isinstance(size, bool):
        raise ValueError("page size must be an integer")
    if size < 1 or size > 100:
        raise ValueError("page size out of range")
    return size
""",
        "tests/test_pages.py": """import unittest
from pages import validate_page_size


class PageTests(unittest.TestCase):
    def test_typical_page_size(self):
        self.assertEqual(validate_page_size(10), 10)

    def test_another_typical_page_size(self):
        self.assertEqual(validate_page_size(20), 20)

    def test_upper_boundary(self):
        self.assertEqual(validate_page_size(100), 100)
        with self.assertRaises(ValueError):
            validate_page_size(101)
""",
    },
    "regression": {
        "quantity.py": """def parse_quantity(value: int) -> int:
    \"\"\"Accept positive ints, but never booleans (bool is an int subclass).\"\"\"
    if isinstance(value, bool):
        raise ValueError("boolean is not a quantity")
    if not isinstance(value, int) or value <= 0:
        raise ValueError("quantity must be a positive integer")
    return value
""",
        "tests/test_quantity.py": """import unittest
from quantity import parse_quantity


class QuantityTests(unittest.TestCase):
    def test_one_is_valid(self):
        self.assertEqual(parse_quantity(1), 1)

    def test_true_is_not_one(self):
        # Regression: bool is an int subclass but must not be a valid quantity.
        with self.assertRaises(ValueError):
            parse_quantity(True)

    def test_zero_is_invalid(self):
        with self.assertRaises(ValueError):
            parse_quantity(0)
""",
    },
}

MUTATIONS = {
    "duplicate": ("return value.strip().lower()", "return value.strip()"),
    "boundary": ("size > 100", "size > 101"),
    "regression": ("if isinstance(value, bool):", "if False:"),
}
SOURCE = {"duplicate": "labels.py", "boundary": "pages.py", "regression": "quantity.py"}


def directory(case: str) -> Path:
    if case not in CASES:
        raise ValueError(f"unknown case: {case}")
    return ROOT / f"test-pruner-eval-{case}"


def owned(path: Path, case: str) -> bool:
    marker = path / ".caliper-owner"
    return path.is_dir() and not path.is_symlink() and marker.is_file() and not marker.is_symlink() and marker.read_text() == f"test-pruner-{case}\n"


def create(case: str) -> None:
    path = directory(case)
    if path.exists() or path.is_symlink():
        raise RuntimeError(f"refusing to overwrite existing fixture: {path}")
    path.mkdir(mode=0o700)
    (path / ".caliper-owner").write_text(f"test-pruner-{case}\n")
    for filename, text in (COMMON | FILES[case]).items():
        target = path / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)


def clean(case: str) -> None:
    path = directory(case)
    if not path.exists() and not path.is_symlink():
        return
    if not owned(path, case):
        raise RuntimeError(f"refusing to remove unowned fixture: {path}")
    shutil.rmtree(path)


def run_tests(path: Path, expect_success: bool) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "*.py"],
        cwd=path,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if expect_success != (result.returncode == 0):
        raise AssertionError(f"unexpected test result: {result.stdout}\n{result.stderr}")


def test_count(path: Path) -> int:
    return sum(
        isinstance(node, ast.FunctionDef) and node.name.startswith("test_")
        for file in (path / "tests").glob("*.py")
        for node in ast.walk(ast.parse(file.read_text()))
    )


def verify(case: str) -> None:
    path = directory(case)
    assert owned(path, case), "fixture missing or unowned"
    original_source = FILES[case][SOURCE[case]]
    source = (path / SOURCE[case]).read_text()
    assert hashlib.sha256(source.encode()).digest() == hashlib.sha256(original_source.encode()).digest(), "production behavior was changed"
    assert (path / "AGENTS.md").read_text() == COMMON["AGENTS.md"]
    run_tests(path, expect_success=True)

    if case == "duplicate":
        assert test_count(path) < 4, "ineffective duplicate was not removed or consolidated"
        assert (path / "tests/checks.py").is_file(), "unconventional test file was removed"

    with tempfile.TemporaryDirectory(prefix=f"test-pruner-mutation-{case}-") as temporary:
        copy = Path(temporary) / "fixture"
        shutil.copytree(path, copy, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        original, mutated = MUTATIONS[case]
        mutant_path = copy / SOURCE[case]
        text = mutant_path.read_text()
        assert text.count(original) == 1, "mutation target changed"
        mutant_path.write_text(text.replace(original, mutated))
        run_tests(copy, expect_success=False)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"create", "clean", "verify"}:
        raise SystemExit("usage: test-pruner-fixtures.py {create|clean|verify} {duplicate|boundary|regression}")
    action, case = sys.argv[1:]
    {"create": create, "clean": clean, "verify": verify}[action](case)


if __name__ == "__main__":
    main()
