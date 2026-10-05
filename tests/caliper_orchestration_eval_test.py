#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
EVAL_DIR = ROOT / ".pi/agent/evals/orchestration"
CHECK_PATH = EVAL_DIR / "check.py"
LAUNCH_PATH = EVAL_DIR / "launch.py"
ASSIGNED = "assigned-regression-nonce-42"
MARKER = "steered-private-marker-73"
EXPECTED = {"assigned": ASSIGNED, "instructions_enabled": True}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CHECK = load_module("caliper_orchestration_check", CHECK_PATH)


def make_steering_trace():
    return [
        {"kind": "instructions", "parent": True, "loaded": True},
        {
            "kind": "call", "id": "spawn", "parent": True, "session": "parent-session",
            "tool": "subagent", "input": {
                "run_in_background": True, "max_turns": 4,
                "prompt": "Read assigned.txt and report its contents.",
            },
        },
        {"kind": "result", "id": "spawn", "tool": "subagent", "text": "Agent ID: child-42", "error": False},
        {
            "kind": "call", "id": "child-gate", "parent": False, "session": "child-session",
            "tool": "eval_gate", "input": {"action": "wait"},
        },
        {"kind": "checkpoint-ready", "parent": False, "session": "child-session"},
        {
            "kind": "call", "id": "observe", "parent": True, "session": "parent-session",
            "tool": "eval_gate", "input": {"action": "observe"},
        },
        {"kind": "challenge", "parent": True, "session": "parent-session", "marker": MARKER},
        {
            "kind": "result", "id": "observe", "tool": "eval_gate",
            "text": f"Scope-change checkpoint; steering marker: {MARKER}", "error": False,
        },
        {
            "kind": "call", "id": "assessment", "parent": True, "session": "parent-session",
            "tool": "assess_subagent_checkpoint", "input": {
                "agentId": "child-42", "checkpointKind": "scope-change",
            },
        },
        {
            "kind": "result", "id": "assessment", "tool": "assess_subagent_checkpoint",
            "text": '{"status":"assessed"}', "error": False,
        },
        {
            "kind": "call", "id": "steer", "parent": True, "session": "parent-session",
            "tool": "steer_subagent", "input": {
                "agent_id": "child-42", "message": f"Stay in scope; read assigned.txt only. {MARKER}",
            },
        },
        {
            "kind": "result", "id": "steer", "tool": "steer_subagent",
            "text": "Steering message sent to agent child-42", "error": False,
        },
        {"kind": "released", "child": "child-session", "agentId": "child-42"},
        {
            "kind": "result", "id": "child-gate", "tool": "eval_gate",
            "text": "Checkpoint released", "error": False,
        },
        {
            "kind": "call", "id": "child-read", "parent": False, "session": "child-session",
            "tool": "read", "input": {"path": "/fixture/assigned.txt"},
        },
        {
            "kind": "result", "id": "child-read", "tool": "read",
            "text": ASSIGNED, "error": False,
        },
        {"kind": "assistant", "parent": False, "session": "child-session", "text": f"assigned.txt contains {ASSIGNED}; acknowledged {MARKER}.", "stopReason": "stop", "hasToolCalls": False},
        {
            "kind": "call", "id": "parent-result", "parent": True, "session": "parent-session",
            "tool": "get_subagent_result", "input": {"agent_id": "child-42"},
        },
        {
            "kind": "result", "id": "parent-result", "tool": "get_subagent_result",
            "text": f"assigned.txt contains {ASSIGNED}", "error": False,
        },
        {"kind": "assistant", "parent": True, "session": "parent-session", "text": f"Verified assigned.txt contains {ASSIGNED}.", "stopReason": "stop", "hasToolCalls": False},
    ]


def make_simple_trace(case):
    events = [{"kind": "instructions", "parent": True, "loaded": True}]
    if case == "direct":
        events.extend([
            {
                "kind": "call", "id": "direct-read", "parent": True, "session": "parent-session",
                "tool": "read", "input": {"path": "/fixture/assigned.txt"},
            },
            {
                "kind": "result", "id": "direct-read", "tool": "read",
                "text": ASSIGNED, "error": False,
            },
            {"kind": "assistant", "parent": True, "session": "parent-session", "text": f"assigned.txt contains {ASSIGNED}.", "stopReason": "stop", "hasToolCalls": False},
        ])
    else:
        events.append({"kind": "assistant", "parent": True, "session": "parent-session", "text": '{"intervene": false}', "stopReason": "stop", "hasToolCalls": False})
    return events


class CaliperOrchestrationCheckTests(unittest.TestCase):
    def test_accepts_a_valid_steering_trace_with_steering_only_marker(self):
        CHECK.check_events(make_steering_trace(), EXPECTED, "steering")

    def test_rejects_fabricated_content_after_an_unrelated_read_result(self):
        events = make_steering_trace()
        result = next(e for e in events if e.get("id") == "child-read" and e["kind"] == "result")
        result["text"] = "different content"
        with self.assertRaisesRegex(AssertionError, "read result missing"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_accepts_direct_and_routine_traces_without_orchestration(self):
        for case in ("direct", "routine"):
            with self.subTest(case=case):
                CHECK.check_events(make_simple_trace(case), EXPECTED, case)

    def test_accepts_explicitly_disabled_instructions(self):
        events = make_steering_trace()
        events[0]["loaded"] = False
        expected = {**EXPECTED, "instructions_enabled": False}
        CHECK.check_events(events, expected, "steering")

    def test_rejects_a_parent_final_claim_without_worker_read_evidence(self):
        events = make_steering_trace()
        events = [
            event for event in events
            if event.get("id") not in ("child-read",) and not (
                event.get("kind") == "assistant" and event.get("session") == "child-session"
            )
        ]
        with self.assertRaisesRegex(AssertionError, "Missing target worker read"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_rejects_steering_or_assessment_for_the_wrong_worker(self):
        events = make_steering_trace()
        next(event for event in events if event.get("id") == "steer")["input"]["agent_id"] = "child-elsewhere"
        with self.assertRaisesRegex(AssertionError, "addressed the wrong worker"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_rejects_assessment_after_steering(self):
        events = make_steering_trace()
        assessment = next(event for event in events if event.get("id") == "assessment")
        assessed = next(event for event in events if event.get("id") == "assessment" and event["kind"] == "result")
        events.remove(assessment)
        events.remove(assessed)
        release_index = next(index for index, event in enumerate(events) if event["kind"] == "released")
        events[release_index + 1:release_index + 1] = [assessment, assessed]
        with self.assertRaisesRegex(AssertionError, "Incorrect checkpoint/assessment/steering order"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_rejects_a_worker_read_before_steering(self):
        events = make_steering_trace()
        read_call = next(event for event in events if event.get("id") == "child-read" and event["kind"] == "call")
        read_result = next(event for event in events if event.get("id") == "child-read" and event["kind"] == "result")
        events.remove(read_call)
        events.remove(read_result)
        steer_index = next(index for index, event in enumerate(events) if event.get("id") == "steer")
        events[steer_index:steer_index] = [read_call, read_result]
        with self.assertRaisesRegex(AssertionError, "read before steering"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_rejects_a_worker_read_outside_the_narrowed_scope(self):
        events = make_steering_trace()
        read_call = next(event for event in events if event.get("id") == "child-read" and event["kind"] == "call")
        read_call["input"]["path"] = "/fixture/outside-scope.txt"
        with self.assertRaisesRegex(AssertionError, "ignored the narrowed scope"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_rejects_a_parent_final_when_the_child_has_no_final_response(self):
        events = [
            event for event in make_steering_trace()
            if not (event.get("kind") == "assistant" and event.get("session") == "child-session")
        ]
        with self.assertRaisesRegex(AssertionError, "Worker did not report the actual file content"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_rejects_unavailable_jev_assessment(self):
        events = make_steering_trace()
        result = next(event for event in events if event.get("id") == "assessment" and event["kind"] == "result")
        result["text"] = '{"status":"unavailable"}'
        with self.assertRaisesRegex(AssertionError, "Jev assessment unavailable"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_rejects_missing_parent_instructions(self):
        events = [event for event in make_steering_trace() if event["kind"] != "instructions"]
        with self.assertRaisesRegex(AssertionError, "Wrong instruction treatment"):
            CHECK.check_events(events, EXPECTED, "steering")

    def test_rejects_missing_or_leaked_steering_marker(self):
        missing = make_steering_trace()
        child_final = next(
            event for event in missing
            if event.get("kind") == "assistant" and event.get("session") == "child-session"
        )
        child_final["text"] = child_final["text"].replace(MARKER, "")
        with self.assertRaisesRegex(AssertionError, "steering-only marker"):
            CHECK.check_events(missing, EXPECTED, "steering")

        leaked = make_steering_trace()
        spawn = next(event for event in leaked if event.get("id") == "spawn")
        spawn["input"]["prompt"] += f" {MARKER}"
        with self.assertRaisesRegex(AssertionError, "Marker leaked before steering"):
            CHECK.check_events(leaked, EXPECTED, "steering")

    def test_direct_and_routine_cases_reject_unnecessary_orchestration(self):
        for case, tool in (("direct", "subagent"), ("routine", "assess_subagent_checkpoint")):
            with self.subTest(case=case):
                events = make_simple_trace(case)
                events.insert(1, {
                    "kind": "call", "id": "unnecessary", "parent": True, "session": "parent-session",
                    "tool": tool, "input": {},
                })
                with self.assertRaisesRegex(AssertionError, "Unnecessary orchestration"):
                    CHECK.check_events(events, EXPECTED, case)


class CaliperOrchestrationLaunchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        support = load_module("caliper_fixture_support", ROOT / "tests/caliper_fixture_support.py")
        self.repo = support.seed_repo(self.root / "repo")
        self.runtime = self.root / "runtime"
        (self.runtime / "home/.pi/agent").mkdir(parents=True)
        self.evidence = self.root / "evidence"
        self.launcher = load_module("orchestration_launcher", LAUNCH_PATH)
        self.launcher.prepare(self.repo, self.runtime, self.evidence, False)
        self.config = json.loads((self.runtime / "orchestration.json").read_text())

    def test_prepare_snapshots_production_models_and_only_required_extensions(self):
        metadata = json.loads((self.evidence / "metadata.json").read_text())
        self.assertEqual(metadata["catalog"]["parent"]["model"], "openai-codex/mock-parent-fast")
        self.assertEqual(metadata["catalog"]["parent"]["thinking"], "xhigh")
        self.assertEqual(metadata["catalog"]["agents"]["quick"]["model"], "openai-codex/mock-quick")
        source_instructions = self.repo / ".pi/agent/instructions/orchestration"
        expected_hashes = {
            f"orchestration/{source.name}": hashlib.sha256(source.read_bytes()).hexdigest()
            for source in sorted(source_instructions.glob("*.md"))
        }
        self.assertEqual(metadata["instruction_sha256"], expected_hashes)
        snapshots = self.evidence / "instructions/orchestration"
        self.assertEqual({path.name for path in snapshots.iterdir()}, {"index.md", "assignments.md", "coordination.md", "routing.md", "supervision.md"})
        self.assertFalse((self.evidence / "orchestration.md").exists())
        self.assertEqual(len(self.config["extensions"]), 5)
        self.assertTrue(any(path.endswith("openai-capabilities.ts") for path in self.config["extensions"]))
        self.assertEqual(json.loads((self.runtime / "home/.pi/agent/settings.json").read_text()), {})

    def test_missing_extension_and_unconfigured_model_fail_loudly(self):
        with self.assertRaisesRegex(ValueError, "not configured"):
            self.launcher.prepare(self.repo, self.runtime, self.evidence, False, "gpt-5.5")
        (self.repo / ".pi/agent/extensions/openai-capabilities.ts").unlink()
        with self.assertRaisesRegex(ValueError, "Required extension"):
            self.launcher.prepare(self.repo, self.runtime, self.evidence, False)

    def test_attempt_keeps_auth_and_specialist_presets_but_not_ambient_settings(self):
        home = self.root / "attempt"
        agent = home / ".pi/agent"
        agent.mkdir(parents=True)
        (agent / "auth.json").write_text("private-auth")
        (agent / "settings.json").write_text('{"packages":["ambient"]}')
        work = self.launcher.configure_attempt(home, agent, self.config, self.root / "trace.jsonl", "parallel")
        settings = json.loads((agent / "settings.json").read_text())
        self.assertEqual(settings["packages"], [])
        self.assertEqual(settings["extensions"], self.config["extensions"])
        self.assertEqual((agent / "auth.json").read_text(), "private-auth")
        self.assertIn("model: openai-codex/mock-review", (agent / "agents/review.md").read_text())
        copied_instructions = agent / "instructions/orchestration"
        self.assertEqual(
            {path.name for path in copied_instructions.iterdir()},
            {"index.md", "assignments.md", "coordination.md", "routing.md", "supervision.md"},
        )
        self.assertEqual(
            (copied_instructions / "index.md").read_text(),
            (self.evidence / "instructions/orchestration/index.md").read_text(),
        )
        self.assertFalse((agent / "instructions/orchestration.md").exists())
        self.assertEqual(json.loads((agent / "subagents.json").read_text())["maxConcurrent"], 3)
        self.assertTrue((agent / "models.json").exists())
        self.assertTrue((home / ".agents/skills/swarm/SKILL.md").exists())
        self.assertTrue((work / "left.txt").exists())
        self.assertIn("explore.md", [p.name for p in (agent / "agents").iterdir()])
        self.assertNotIn("Explore.md", [p.name for p in (agent / "agents").iterdir()])
        self.assertIn("enabled: false", (work / ".pi/agents/Explore.md").read_text())

    def test_disabled_instructions_and_wrong_agent_directory(self):
        home = self.root / "attempt"
        agent = home / ".pi/agent"
        config = {**self.config, "instructions_enabled": False}
        self.launcher.configure_attempt(home, agent, config, self.root / "trace.jsonl")
        self.assertFalse((agent / "instructions/orchestration/index.md").exists())
        with self.assertRaisesRegex(ValueError, "Unexpected Caliper agent"):
            self.launcher.configure_attempt(home, self.root / "wrong", config, self.root / "other.jsonl")

    def test_version_probe_clears_stale_evidence_without_loading_extensions(self):
        latest = self.evidence / "latest.json"
        latest.write_text('{"trace":"stale"}')
        with mock.patch.object(self.launcher, "__file__", str(self.runtime / "orchestration-launch.py")), mock.patch.dict("os.environ", {"HOME": str(self.runtime / "home")}, clear=True), mock.patch.object(self.launcher.subprocess, "call", return_value=0) as run:
            self.assertEqual(self.launcher.launch("pi", ["--version"]), 0)
        self.assertFalse(latest.exists())
        self.assertEqual(run.call_args.args[0], ["pi", "--no-extensions", "--version"])

    def test_case_marker_is_hidden_and_attempt_exit_is_recorded(self):
        home = self.root / "attempt"
        agent = home / ".pi/agent"
        with mock.patch.object(self.launcher, "__file__", str(self.runtime / "orchestration-launch.py")), mock.patch.dict("os.environ", {"HOME": str(home), "PI_CODING_AGENT_DIR": str(agent)}, clear=True), mock.patch.object(self.launcher.subprocess, "call", return_value=17) as run:
            self.assertEqual(self.launcher.launch("pi", ["--print", "[[orchestration-case:direct]]\nRead assigned.txt"]), 17)
        self.assertEqual(run.call_args.args[0][-1], "Read assigned.txt")
        self.assertEqual(run.call_args.kwargs["env"]["ORCHESTRATION_CASE"], "direct")
        self.assertEqual(json.loads((self.evidence / "latest.json").read_text())["exit_code"], 17)
        with self.assertRaisesRegex(ValueError, "case marker"):
            self.launcher.extract_case(["not a scenario"])



if __name__ == "__main__":
    unittest.main()
