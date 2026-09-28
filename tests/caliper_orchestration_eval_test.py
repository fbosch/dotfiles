#!/usr/bin/env python3
import importlib.util
import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path

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
    def make_repo(self, root):
        repo = root / "repo"
        agent = repo / ".pi/agent"
        fixture = agent / "evals/orchestration"
        extension_root = agent / "npm/node_modules/@gotgenes/pi-subagents"
        files = (
            extension_root / "src/index.ts",
            agent / "extensions/instruction-fragments.ts",
            agent / "extensions/recommend-agent/index.ts",
            fixture / "fixture.ts",
        )
        for path in files:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("// synthetic installed extension\n")
        (extension_root / "package.json").write_text('{"version":"9.8.7"}\n')
        instructions = agent / "instructions/orchestration.md"
        instructions.parent.mkdir(parents=True, exist_ok=True)
        instructions.write_text("# Synthetic orchestration instructions\n")
        return repo, agent, fixture

    def test_prepare_records_mocked_native_extension_metadata_and_preserves_auth(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo, agent, _ = self.make_repo(root)
            run_root = root / "run"
            (run_root / "home/.pi/agent").mkdir(parents=True)
            auth = run_root / "home/.pi/agent/auth.json"
            auth.write_text('{"token":"local-only-test-value"}\n')
            evidence = root / "evidence"

            launcher = load_module("caliper_orchestration_launch_prepare", LAUNCH_PATH)
            launcher.prepare(repo, run_root, evidence, False, "test-worker-model")

            metadata = json.loads((evidence / "metadata.json").read_text())
            self.assertEqual(metadata["worker_model"], "openai-codex/test-worker-model")
            self.assertTrue(metadata["instructions_enabled"])
            self.assertEqual(metadata["subagents_version"], "9.8.7")
            self.assertEqual((evidence / "orchestration.md").read_text(), (agent / "instructions/orchestration.md").read_text())
            self.assertEqual(json.loads(auth.read_text()), {"token": "local-only-test-value"})
            config = json.loads((run_root / "orchestration.json").read_text())
            self.assertEqual(
                config["extensions"],
                [str(repo / relative_path) for relative_path in metadata["extensions"]],
            )
            self.assertTrue((run_root / "orchestration-launch.py").is_file())

    def test_prepare_rejects_a_missing_native_extension(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo = root / "repo"
            agent = repo / ".pi/agent"
            (agent / "instructions").mkdir(parents=True)
            (agent / "instructions/orchestration.md").write_text("instructions\n")
            run_root = root / "run"
            (run_root / "home/.pi/agent").mkdir(parents=True)
            launcher = load_module("caliper_orchestration_launch_missing", LAUNCH_PATH)

            with self.assertRaisesRegex(ValueError, "Required extension not installed"):
                launcher.prepare(repo, run_root, root / "evidence", False, "model")

    def test_configure_attempt_replaces_inherited_settings_with_minimal_allowlist(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home = root / "attempt home"
            agent = home / ".pi/agent"
            agent.mkdir(parents=True)
            auth = agent / "auth.json"
            auth.write_text('{"token":"do-not-touch"}\n')
            inherited = {
                "packages": ["unrelated-package"], "extensions": ["unrelated-extension"],
                "skills": ["unrelated-skill"], "prompts": ["unrelated-prompt"],
                "mcpServers": {"unrelated": {"command": "not-used"}},
            }
            (agent / "settings.json").write_text(json.dumps(inherited))
            evidence = root / "evidence"
            evidence.mkdir()
            instruction_text = "# Included instructions\n"
            (evidence / "orchestration.md").write_text(instruction_text)
            extension_paths = [str(root / "extensions/instruction-fragments.ts")]
            config = {
                "extensions": extension_paths,
                "evidence": str(evidence),
                "instructions_enabled": True,
                "worker_model": "openai-codex/test-worker-model",
            }
            launcher = load_module("caliper_orchestration_launch_configure", LAUNCH_PATH)

            work = launcher.configure_attempt(home, agent, config, root / "trace.jsonl")

            settings = json.loads((agent / "settings.json").read_text())
            self.assertEqual(settings, {
                "packages": [], "extensions": extension_paths, "skills": [], "prompts": [],
                "defaultProjectTrust": "always", "jev": {"recommendAgent": {"enabled": True}},
            })
            self.assertEqual(auth.read_text(), '{"token":"do-not-touch"}\n')
            self.assertEqual((agent / "instructions/orchestration.md").read_text(), instruction_text)
            definition = (agent / "agents/quick.md").read_text()
            self.assertIn("model: openai-codex/test-worker-model", definition)
            self.assertIn("max_turns: 6", definition)
            self.assertEqual((work / "outside-scope.txt").read_text(), "Unnecessary scope: do not inspect.\n")
            expected = json.loads((root / "trace.expected.json").read_text())
            self.assertEqual(expected, {
                "assigned": (work / "assigned.txt").read_text().strip(),
                "instructions_enabled": True,
            })

    def test_configure_attempt_omits_disabled_instructions_and_checks_agent_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            home = root / "attempt home"
            agent = home / ".pi/agent"
            evidence = root / "evidence"
            evidence.mkdir()
            (evidence / "orchestration.md").write_text("# Disabled\n")
            config = {
                "extensions": [], "evidence": str(evidence),
                "instructions_enabled": False, "worker_model": "openai-codex/model",
            }
            launcher = load_module("caliper_orchestration_launch_disabled", LAUNCH_PATH)

            work = launcher.configure_attempt(home, agent, config, root / "trace.jsonl")

            self.assertFalse((agent / "instructions/orchestration.md").exists())
            self.assertFalse(json.loads((root / "trace.expected.json").read_text())["instructions_enabled"])
            with self.assertRaisesRegex(ValueError, "Unexpected Caliper agent directory"):
                launcher.configure_attempt(home, root / "wrong-agent", config, root / "other.jsonl")
            self.assertEqual((work / "assigned.txt").read_text().strip(), json.loads((root / "trace.expected.json").read_text())["assigned"])

    def test_version_probe_clears_stale_latest_without_creating_a_trace(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            evidence = root / "evidence"
            evidence.mkdir()
            latest = evidence / "latest.json"
            latest.write_text('{"trace":"stale.jsonl","exit_code":0}\n')
            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "orchestration.json").write_text(json.dumps({"evidence": str(evidence)}))
            (runtime / "launch.py").write_text(LAUNCH_PATH.read_text())
            launcher = load_module("caliper_orchestration_launch_version", runtime / "launch.py")
            home = root / "home"
            home.mkdir()

            with mock.patch.dict("os.environ", {"HOME": str(home)}, clear=True), \
                    mock.patch.object(launcher.subprocess, "call", return_value=0) as call:
                status = launcher.launch("mock-pi", ["--version"])

            self.assertEqual(status, 0)
            self.assertFalse(latest.exists())
            argv, kwargs = call.call_args
            self.assertEqual(argv[0], ["mock-pi", "--no-extensions", "--version"])
            self.assertEqual(kwargs["env"]["PI_OFFLINE"], "1")

    def test_attempt_replaces_latest_with_its_own_trace_and_exit_code(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            evidence = root / "evidence"
            evidence.mkdir()
            latest = evidence / "latest.json"
            latest.write_text('{"trace":"stale.jsonl","exit_code":0}\n')
            (evidence / "orchestration.md").write_text("instructions\n")
            home = root / "attempt home"
            agent = home / ".pi/agent"
            agent.mkdir(parents=True)
            runtime = root / "runtime"
            runtime.mkdir()
            (runtime / "orchestration.json").write_text(json.dumps({
                "evidence": str(evidence), "extensions": [], "instructions_enabled": True,
                "worker_model": "openai-codex/model",
            }))
            (runtime / "launch.py").write_text(LAUNCH_PATH.read_text())
            launcher = load_module("caliper_orchestration_launch_attempt", runtime / "launch.py")

            def fake_pi(argv, cwd, env):
                Path(env["ORCHESTRATION_TRACE"]).write_text("")
                return 17

            with mock.patch.dict("os.environ", {
                "HOME": str(home), "PI_CODING_AGENT_DIR": str(agent),
            }, clear=True), mock.patch.object(launcher.subprocess, "call", side_effect=fake_pi) as call:
                status = launcher.launch("mock-pi", ["candidate"])

            self.assertEqual(status, 17)
            pointer = json.loads(latest.read_text())
            trace = Path(pointer["trace"])
            self.assertEqual(trace.parent, evidence)
            self.assertNotEqual(trace.name, "stale.jsonl")
            self.assertTrue(trace.is_file())
            self.assertEqual(pointer["exit_code"], 17)
            argv, kwargs = call.call_args
            self.assertEqual(argv[0], ["mock-pi", "--no-skills", "--no-prompt-templates", "candidate"])
            self.assertEqual(kwargs["env"]["PI_OFFLINE"], "1")


if __name__ == "__main__":
    unittest.main()
