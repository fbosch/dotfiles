import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CHECK = load("scenario_check", ROOT / ".pi/agent/evals/orchestration/check.py")
MODELS = load("production_models", ROOT / ".pi/agent/evals/orchestration/model_config.py")
SUPPORT = load("fixture_support", ROOT / "tests/caliper_fixture_support.py")
EXPECTED = {"instructions_enabled": True, "left": "LEFT", "right": "RIGHT", "handoff": "HANDOFF", "first": "FIRST", "second": "SECOND", "finding": "FINDING", "blocker": "BLOCKER"}


def trace_for(case):
    events = [{"kind": "instructions", "parent": True, "loaded": True}]

    def spawn(role, number, prompt="read-only src renderBadge return file and line; verify exported; do not execute commands", resume=None):
        args = {"subagent_type": role, "prompt": prompt, "run_in_background": True, "max_turns": 8}
        if resume:
            args["resume"] = resume
        events.append({"kind": "call", "parent": True, "session": "parent", "id": f"spawn{number}", "tool": "subagent", "input": args})
        events.append({"kind": "result", "id": f"spawn{number}", "tool": "subagent", "text": f"Agent ID: worker{number}", "error": False})

    def report(filename, text, child="child1"):
        identifier = "read-" + filename
        events.append({"kind": "call", "parent": False, "session": child, "id": identifier, "tool": "read", "input": {"path": filename}})
        events.append({"kind": "result", "id": identifier, "tool": "read", "text": text, "error": False})
        events.append({"kind": "assistant", "parent": False, "session": child, "text": text, "stopReason": "stop", "hasToolCalls": False})

    if case.startswith("selection-") or case == "delegation":
        role = case.removeprefix("selection-") if case.startswith("selection-") else "explore"
        spawn(role, 1)
        filename, answer = {"explore": ("src/badge.ts", "renderBadge exported in badge.ts:1"), "debug": ("src/ratio.ts", "0 / 0 causes NaN"), "review": ("src/access.ts", "owner check is inverted by !==")}[role]
        report(filename, answer)
    elif case == "parallel":
        spawn("quick", 1, "left.txt only")
        spawn("quick", 2, "right.txt only")
        for key in ("left", "right"):
            events.append({"kind": "barrier-arrived", "session": key, "key": key})
        for key in ("left", "right"):
            events.append({"kind": "barrier-passed", "session": key, "key": key})
            report(key + ".txt", EXPECTED[key], key)
        answer = "LEFT RIGHT"
    elif case == "dependency":
        spawn("explore", 1)
        report("discover.txt", "HANDOFF")
        spawn("analyze", 2, "Verify dependent.txt using HANDOFF")
        report("dependent.txt", "Verified HANDOFF", "child2")
        answer = "HANDOFF"
    elif case == "resume":
        spawn("quick", 1)
        report("first.txt", "FIRST")
        spawn("quick", 2, "Continue with second.txt", resume="worker1")
        report("second.txt", "FIRST SECOND")
        answer = "FIRST SECOND"
    else:
        spawn("analyze", 1)
        key = "finding" if case == "material" else "blocker"
        report(key + ".txt", EXPECTED[key])
        answer = json.dumps({"decision": "revise-design", "streaming_supported": False, "evidence": "FINDING"} if case == "material" else {"decision": "needs-input", "account_id": None, "evidence": "BLOCKER"})
    events.append({"kind": "assistant", "parent": True, "session": "parent", "text": answer, "stopReason": "stop", "hasToolCalls": False})
    return events


class ScenarioGraderTests(unittest.TestCase):
    def test_every_new_scenario_accepts_observable_success(self):
        for case in ("selection-explore", "selection-debug", "selection-review", "delegation", "parallel", "dependency", "resume", "material", "blocker"):
            with self.subTest(case=case):
                CHECK.check_events(trace_for(case), EXPECTED, case)

    def test_wrong_specialist_and_incomplete_delegation_fail(self):
        for case in ("selection-explore", "selection-debug", "selection-review", "delegation"):
            events = trace_for(case)
            spawn = CHECK.calls(events, "subagent")[0]
            if case == "delegation":
                spawn["input"]["prompt"] = "Find it"
            else:
                spawn["input"]["subagent_type"] = "quick"
            with self.subTest(case=case), self.assertRaises(AssertionError):
                CHECK.check_events(events, EXPECTED, case)

    def test_serial_or_single_worker_parallel_claims_fail(self):
        for mode in ("serial", "same-worker", "foreground"):
            events = trace_for("parallel")
            arrivals = [e for e in events if e["kind"] == "barrier-arrived"]
            if mode == "serial":
                passed = next(e for e in events if e["kind"] == "barrier-passed")
                events.remove(passed)
                events.insert(events.index(arrivals[1]), passed)
            elif mode == "same-worker":
                arrivals[1]["session"] = arrivals[0]["session"]
            else:
                CHECK.calls(events, "subagent")[1]["input"]["run_in_background"] = False
            with self.subTest(mode=mode), self.assertRaises(AssertionError):
                CHECK.check_events(events, EXPECTED, "parallel")

    def test_dependency_requires_completed_prerequisite_and_forwarded_evidence(self):
        for early in (True, False):
            events = trace_for("dependency")
            second = CHECK.calls(events, "subagent")[1]
            if early:
                events.remove(second)
                events.insert(2, second)
            else:
                second["input"]["prompt"] = "Verify dependent.txt"
            with self.subTest(early=early), self.assertRaises(AssertionError):
                CHECK.check_events(events, EXPECTED, "dependency")

    def test_resume_requires_original_worker_and_session(self):
        for mode in ("fresh", "wrong-id", "wrong-session"):
            events = trace_for("resume")
            resume = CHECK.calls(events, "subagent")[1]
            if mode == "fresh":
                del resume["input"]["resume"]
            elif mode == "wrong-id":
                resume["input"]["resume"] = "someone-else"
            else:
                next(e for e in events if e.get("id") == "read-second.txt" and e["kind"] == "call")["session"] = "other-child"
            with self.subTest(mode=mode), self.assertRaises(AssertionError):
                CHECK.check_events(events, EXPECTED, "resume")

    def test_natural_findings_need_grounded_decisions_not_forced_jev_calls(self):
        for case in ("material", "blocker"):
            events = trace_for(case)
            self.assertEqual(CHECK.calls(events, "assess_subagent_checkpoint"), [])
            CHECK.check_events(events, EXPECTED, case)
            bad = copy.deepcopy(events)
            decision = json.loads(bad[-1]["text"])
            decision["decision"] = "proceed"
            bad[-1]["text"] = json.dumps(decision)
            with self.subTest(case=case), self.assertRaises(AssertionError):
                CHECK.check_events(bad, EXPECTED, case)

    def test_parallel_lifecycle_is_not_graded_as_budget_syntax(self):
        events = trace_for("parallel")
        for spawn in CHECK.calls(events, "subagent"):
            del spawn["input"]["max_turns"]
        CHECK.check_events(events, EXPECTED, "parallel")

    def test_evidence_identifier_can_be_nested_in_json(self):
        events = trace_for("material")
        decision = json.loads(events[-1]["text"])
        decision["evidence"] = {"identifier": EXPECTED["finding"]}
        events[-1]["text"] = json.dumps(decision)
        CHECK.check_events(events, EXPECTED, "material")

    def test_model_verification_rejects_wrong_preset_or_lost_fast_translation(self):
        expected = {"catalog": {"parent": {"model": "openai-codex/luna-fast", "thinking": "xhigh"}, "agents": {}}}
        events = [{"kind": "session", "session": "p"}, {"kind": "execution", "session": "p", "parent": True, "model": "openai-codex/luna-fast", "thinking": "xhigh"}, {"kind": "request-model", "session": "p", "model": "luna", "serviceTier": "priority"}]
        CHECK.check_models(events, expected)
        for key, value in (("thinking", "low"), ("model", "openai-codex/gpt-5.5")):
            bad = copy.deepcopy(events)
            bad[1][key] = value
            with self.assertRaisesRegex(AssertionError, "production preset"):
                CHECK.check_models(bad, expected)
        bad = copy.deepcopy(events)
        bad[2]["serviceTier"] = "auto"
        with self.assertRaisesRegex(AssertionError, "priority"):
            CHECK.check_models(bad, expected)

    def test_missing_budget_and_partial_delegation_contract_fail(self):
        for field in ("budget", "export", "commands"):
            events = trace_for("delegation")
            args = CHECK.calls(events, "subagent")[0]["input"]
            if field == "budget":
                del args["max_turns"]
            elif field == "export":
                args["prompt"] = args["prompt"].replace("exported", "definition")
            else:
                args["prompt"] = args["prompt"].replace("; do not execute commands", "")
            with self.subTest(field=field), self.assertRaises(AssertionError):
                CHECK.check_events(events, EXPECTED, "delegation")

    def test_parallel_workers_cannot_cross_ownership(self):
        events = trace_for("parallel")
        intrusion = {"kind": "call", "parent": False, "session": "left", "id": "intrusion",
                     "tool": "read", "input": {"path": "unassigned.txt"}}
        events.insert(-1, intrusion)
        with self.assertRaisesRegex(AssertionError, "ownership"):
            CHECK.check_events(events, EXPECTED, "parallel")

    def test_result_cannot_precede_its_call(self):
        events = trace_for("selection-explore")
        call = CHECK.calls(events, "read", False)[0]
        result = CHECK.result_for(events, call)
        events.remove(result)
        events.insert(events.index(call), result)
        with self.assertRaisesRegex(AssertionError, "precedes its call"):
            CHECK.check_events(events, EXPECTED, "selection-explore")


class ProductionModelConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = SUPPORT.seed_repo(Path(self.temp.name) / "repo")

    def test_parent_thinking_must_match_a_production_preset(self):
        with self.assertRaisesRegex(ValueError, "Model/thinking pair"):
            MODELS.resolve_parent(self.repo, "configured", "low")

    def test_parent_defaults_require_native_settings_not_legacy_modes(self):
        settings_path = self.repo / ".pi/agent/settings.json"
        settings_path.write_text(json.dumps({
            "modes": {"build": {"model": "openai-codex/mock-parent-fast", "thinkingLevel": "xhigh"}},
        }))
        with self.assertRaisesRegex(ValueError, "defaultProvider, defaultModel, and defaultThinkingLevel"):
            MODELS.load_catalog(self.repo)

    def test_model_store_snapshot_is_bounded_and_rejects_credentials(self):
        catalog = MODELS.load_catalog(self.repo)
        path = self.repo / ".pi/agent/models-store.json"
        store = json.loads(path.read_text())
        store["openai-codex"]["privateMetadata"] = "must-not-copy"
        store["openai-codex"]["models"].append({"id": "unrelated"})
        path.write_text(json.dumps(store))
        snapshot = MODELS.snapshot_store(self.repo, catalog)
        self.assertNotIn("privateMetadata", snapshot["openai-codex"])
        self.assertNotIn("unrelated", [m["id"] for m in snapshot["openai-codex"]["models"]])
        store["openai-codex"]["models"][0]["baseUrl"] = "https://example.invalid/?token=fake"
        path.write_text(json.dumps(store))
        with self.assertRaisesRegex(ValueError, "credential-bearing"):
            MODELS.snapshot_store(self.repo, catalog)

    def test_default_is_build_preset_not_a_convenient_eval_model(self):
        self.assertEqual(MODELS.resolve_parent(self.repo), ("openai-codex/mock-parent-fast", "xhigh"))
        catalog = MODELS.load_catalog(self.repo)
        self.assertEqual(catalog["agents"]["review"]["model"], "openai-codex/mock-review")
        with self.assertRaisesRegex(ValueError, "not configured"):
            MODELS.resolve_parent(self.repo, "gpt-5.5", "low")

    def test_project_agent_override_and_disabled_agent_are_respected(self):
        directory = self.repo / ".pi/agents"
        directory.mkdir()
        (directory / "review.md").write_text("---\nmodel: openai-codex/project-review\nthinking: high\n---\n")
        (directory / "test.md").write_text("---\nenabled: false\n---\n")
        catalog = MODELS.load_catalog(self.repo)
        self.assertEqual(catalog["agents"]["review"]["model"], "openai-codex/project-review")
        self.assertNotIn("test", catalog["agents"])
        self.assertEqual(catalog["agents"]["review"]["source"], ".pi/agents/review.md")

    def test_invalid_preset_fails_instead_of_falling_back(self):
        (self.repo / ".pi/agent/agents/quick.md").write_text("---\nmodel: guessed\nthinking: low\n---\n")
        with self.assertRaisesRegex(ValueError, "explicit model"):
            MODELS.load_catalog(self.repo)


if __name__ == "__main__":
    unittest.main()
