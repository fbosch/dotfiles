#!/usr/bin/env python3
import itertools
import re
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKER_PATH = ROOT / ".agents/skills/writing-clearly/check-prose.py"
CHECKER = runpy.run_path(str(CHECKER_PATH))
LEGACY_INLINE_CODE = re.compile(r"(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)")
LEGACY_PATTERNS = tuple(
    (rule, re.compile(rf"(?<!\w){phrase}(?!\w)", re.IGNORECASE))
    for rule, phrase in CHECKER["STOCK_PHRASES"]
) + tuple(
    ("jargon", re.compile(rf"(?<!\w){re.escape(term)}(?!\w)", re.IGNORECASE))
    for term in CHECKER["JARGON"]
)


class ProseCheckerTests(unittest.TestCase):
    def run_checker(self, text, suffix=".md"):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / f"draft{suffix}"
            path.write_text(text, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(CHECKER_PATH), str(path)],
                capture_output=True,
                text=True,
                check=False,
            )

    def test_reports_phrase_and_jargon_with_rule_and_source_line(self):
        result = self.run_checker("First line.\nHere's   the thing: use this vector.\n")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(":2: announcement opener: Here's   the thing", result.stdout)
        self.assertIn(":2: jargon: vector", result.stdout)
        self.assertIn("2 warning(s)", result.stderr)

    def test_matcher_preserves_rule_order_multiplicity_and_whitespace(self):
        examples = [
            phrase.replace(r"\s+", "\t")
            for _, phrase in CHECKER["STOCK_PHRASES"]
        ] + list(CHECKER["JARGON"])
        line = (
            " then ".join(reversed(examples))
            + " then "
            + " then ".join(examples[:4])
        )
        expected = [
            (rule, match.group())
            for rule, pattern in LEGACY_PATTERNS
            for match in pattern.finditer(line)
        ]
        actual = [
            (rule, matched)
            for _, rule, matched, _ in CHECKER["findings"](line)
        ]

        self.assertEqual(actual, expected)

    def test_matches_case_insensitively_with_word_boundaries(self):
        result = self.run_checker("A DEEP\tDIVE, but deeper and substrateX.\n")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("business jargon: DEEP\tDIVE", result.stdout)
        self.assertNotIn(": jargon: substrateX", result.stdout)
        self.assertIn("1 warning(s)", result.stderr)

    def test_inline_code_scanner_matches_previous_regex(self):
        samples = [
            "`deep dive`",
            "``deep ` dive``",
            "`deep `` dive`",
            "``deep dive` and vector``",
            "deep dive` with an unmatched delimiter",
            "deep dive`` with a different unmatched delimiter",
            "`deep dive`x`vector`",
            "one ``` and two `` runs",
        ]
        delimiter_parts = ("`", "``", "```", "x", " ")
        for width in range(1, 5):
            samples.extend(
                "".join(parts)
                for parts in itertools.product(delimiter_parts, repeat=width)
            )

        for line in samples:
            with self.subTest(line=line):
                expected = LEGACY_INLINE_CODE.sub(
                    lambda match: " " * len(match.group()), line
                )
                self.assertEqual(CHECKER["_mask_inline_code"](line), expected)

    def test_ignores_bounded_fenced_and_same_line_inline_code(self):
        text = (
            "Prose `deep dive` protected.\n"
            "```text\n"
            "Use this vector.\n"
            "````\n"
            "~~~\n"
            "Circle back.\n"
            "~~~~\n"
            "Deep dive in prose.\n"
        )
        result = self.run_checker(text)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(":8: business jargon: Deep dive", result.stdout)
        self.assertIn("1 warning(s)", result.stderr)

    def test_unequal_and_adjacent_inline_spans_are_excluded(self):
        result = self.run_checker(
            "``Deep dive ` inside`` and `vector`x`surface`.\n"
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no warnings", result.stdout)

    def test_unmatched_inline_delimiters_remain_prose(self):
        result = self.run_checker(
            "Deep dive before unmatched `.\n"
            "Vector before mismatched ``.\n"
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(":1: business jargon: Deep dive", result.stdout)
        self.assertIn(":2: jargon: Vector", result.stdout)
        self.assertIn("2 warning(s)", result.stderr)

    def test_em_dash_alone_is_not_flagged(self):
        result = self.run_checker("This sentence — including an em dash — is clean.\n")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no warnings", result.stdout)

    def test_invalid_inputs_remain_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.md"
            result = subprocess.run(
                [sys.executable, str(CHECKER_PATH), str(missing)],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(result.returncode, 2)
        self.assertIn("not a file", result.stderr)

    def test_rejects_unsupported_file_type(self):
        result = self.run_checker("text", suffix=".py")

        self.assertEqual(result.returncode, 2)
        self.assertIn("unsupported file type", result.stderr)


if __name__ == "__main__":
    unittest.main()
