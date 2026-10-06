#!/usr/bin/env python3
"""Offline checks of codemode arm isolation, snapshots, and failure reporting."""
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from caliper_fixture_support import seed_repo

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".pi/agent/evals/codemode"
SPEC = importlib.util.spec_from_file_location("codemode_launch", SOURCE / "launch.py")
assert SPEC and SPEC.loader
LAUNCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAUNCH)


class CodemodeEvalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = seed_repo(self.root / "repo")
        target = self.repo / ".pi/agent/evals/codemode"
        shutil.copytree(SOURCE, target, ignore=shutil.ignore_patterns("__pycache__"))
        (self.repo / ".pi/agent/AGENTS.md").write_text("- Use codemode for independent calls.\n- Unrelated instruction.\n")

    def prepare(self, baseline):
        run = self.root / ("baseline" if baseline else "candidate")
        (run / "home/.pi/agent").mkdir(parents=True)
        evidence = run / "evidence"
        LAUNCH.prepare(self.repo, run, evidence, baseline, "openai-codex/mock-parent-fast", "xhigh")
        return run, evidence, json.loads((run / "codemode.json").read_text())

    def test_arms_share_model_extensions_and_exact_candidate_snapshot(self):
        _, baseline, a = self.prepare(True)
        _, candidate, b = self.prepare(False)
        self.assertEqual(a["model"], b["model"])
        self.assertEqual(a["thinking"], b["thinking"])
        self.assertEqual(a["extensions"], b["extensions"])
        self.assertEqual(a["source_sha256"], b["source_sha256"])
        self.assertEqual((candidate / "candidate.md").read_bytes(), (SOURCE / "candidate.md").read_bytes())
        self.assertEqual((baseline / "baseline.md").read_text(), "- Use codemode for independent calls.\n")
        self.assertEqual(a["arm"], "baseline")
        self.assertEqual(b["arm"], "candidate")

    def test_attempt_isolation_preserves_fixtures_and_injects_only_selected_rule(self):
        run, _, config = self.prepare(False)
        home = run / "attempt"
        agent = home / ".pi/agent"
        trace = run / "evidence/attempt.jsonl"
        work = LAUNCH.configure_attempt(home, agent, config, trace, "dependent")
        self.assertEqual((work / "manifest.json").read_text(), '{"files":["a.ts","b.ts"]}\n')
        self.assertIn((SOURCE / "candidate.md").read_text(), (agent / "SYSTEM.md").read_text())
        settings = json.loads((agent / "settings.json").read_text())
        self.assertEqual(settings["defaultTools"], ["read", "write", "check_one", "check_two", "codemode"])
        self.assertEqual(settings["packages"], [])
        expected = json.loads(trace.with_suffix(".expected.json").read_text())
        self.assertEqual(expected["case"], "dependent")
        with self.assertRaises(FileExistsError):
            LAUNCH.configure_attempt(home, agent, config, trace, "dependent")

    def test_refuses_agent_directory_outside_attempt_home(self):
        run, _, config = self.prepare(False)
        with self.assertRaisesRegex(ValueError, "Unexpected Caliper agent directory"):
            LAUNCH.configure_attempt(run / "attempt", self.repo / ".pi/agent", config, run / "trace.jsonl", "single")

    def test_launch_strips_marker_but_preserves_task_and_actual_exit_code(self):
        run, evidence, _ = self.prepare(False)
        home = run / "attempt"
        with patch.object(LAUNCH, "__file__", str(run / "codemode-launch.py")), patch.dict(os.environ, {
            "HOME": str(home), "PI_CODING_AGENT_DIR": str(home / ".pi/agent"),
        }), patch.object(LAUNCH.subprocess, "call", return_value=17) as call:
            self.assertEqual(LAUNCH.launch("pi", ["--print", "[[codemode-case:single]] Read a.ts."]), 17)
        argv = call.call_args.args[0]
        self.assertEqual(argv[-1], "Read a.ts.")
        self.assertIn("--no-builtin-tools", argv)
        self.assertEqual(json.loads((evidence / "latest.json").read_text())["exit_code"], 17)


if __name__ == "__main__":
    unittest.main()
