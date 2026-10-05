"""Grade observed lifecycle and artifact evidence, not orchestration claims."""
import json
import os
import re
from pathlib import Path


def calls(events, tool=None, parent=True):
    return [e for e in events if e["kind"] == "call" and e["parent"] == parent and (tool is None or e["tool"] == tool)]


def completed(events, parent=None):
    return [e for e in events if e["kind"] == "assistant" and e.get("stopReason") == "stop"
            and e.get("hasToolCalls") is False and (parent is None or e["parent"] == parent)]


def is_instruction_reference(path, expected):
    home = os.environ.get("HOME")
    allowed_names = set(expected.get("instruction_reference_files", []))
    if not home or not allowed_names or not isinstance(path, str):
        return False
    if path.startswith("~/"):
        candidate = Path(home) / path[2:]
    elif Path(path).is_absolute():
        candidate = Path(path)
    else:
        return False
    try:
        root = (Path(home) / ".pi/agent/instructions/orchestration").resolve()
        relative = candidate.resolve().relative_to(root)
    except (OSError, RuntimeError, ValueError):
        return False
    return len(relative.parts) == 1 and relative.name in allowed_names and relative.suffix == ".md"


def instruction_reference_reads(events, expected):
    return sum(
        event["kind"] == "call" and event.get("parent") and event.get("tool") in ("read", "grep", "find", "ls")
        and is_instruction_reference(event.get("input", {}).get("path"), expected)
        for event in events
    )


def is_swarm_skill_read(path):
    home = os.environ.get("HOME")
    if not home or not isinstance(path, str):
        return False
    if path.startswith("~/"):
        candidate = Path(home) / path[2:]
    elif Path(path).is_absolute():
        candidate = Path(path)
    else:
        return False
    try:
        return candidate.resolve() == (Path(home) / ".agents/skills/swarm/SKILL.md").resolve()
    except (OSError, RuntimeError):
        return False


def result_for(events, call):
    matches = [e for e in events if e["kind"] == "result" and e["id"] == call["id"]]
    assert matches and not matches[-1].get("error"), f"Missing successful {call['tool']} result"
    assert events.index(call) < events.index(matches[-1]), "Tool result precedes its call"
    return matches[-1]


def worker_id(events, spawn):
    match = re.search(r"Agent ID: ([\w.-]+)", result_for(events, spawn)["text"])
    assert match, "Native spawn did not return an agent ID"
    return match[1]


def child_read(events, filename, token=None):
    reads = [e for e in calls(events, "read", False) if Path(e["input"]["path"]).name == filename]
    assert reads, f"Missing worker read: {filename}"
    read = reads[-1]
    result = result_for(events, read)
    finals = [e for e in completed(events, False) if e["session"] == read["session"]]
    if token:
        assert token in result["text"], "Worker read result missing assigned content"
        finals = [e for e in finals if token in e["text"]]
    assert finals, "Worker did not report the actual file content"
    assert events.index(result) < events.index(finals[-1]), "Worker report precedes read results"
    return read, finals[-1]


def child_source_evidence(events, filename):
    for call in calls(events, parent=False):
        if call["tool"] not in ("read", "grep"):
            continue
        result = result_for(events, call)
        is_read = call["tool"] == "read" and Path(call["input"].get("path", "")).name == filename
        is_match = call["tool"] == "grep" and filename + ":" in result["text"]
        if not (is_read or is_match) or not result["text"].strip():
            continue
        reports = [e for e in completed(events, False) if e["session"] == call["session"] and events.index(e) > events.index(result)]
        if reports:
            return call, reports[-1]
    raise AssertionError(f"Missing worker source evidence: {filename}")


def check_models(events, expected):
    catalog = expected.get("catalog")
    if catalog is None:  # Unit traces exercise the grader independently of the runtime.
        return
    executions = [e for e in events if e["kind"] == "execution"]
    assert executions and any(e["parent"] for e in executions), "Missing runtime model evidence"
    sessions = {e["session"] for e in events if e["kind"] == "session"}
    assert sessions <= {e["session"] for e in executions}, "Session lacks model/thinking evidence"
    for execution in executions:
        preset = catalog["parent"] if execution["parent"] else catalog["agents"].get(execution.get("role"))
        assert preset, "Unknown worker role in execution trace"
        assert (execution["model"], execution["thinking"]) == (preset["model"], preset["thinking"]), "Runtime model/thinking differs from production preset"
        requests = [e for e in events if e["kind"] == "request-model" and e["session"] == execution["session"]]
        assert requests, "No provider request for configured model"
        model = preset["model"].split("/", 1)[1]
        for request in requests:
            assert request["model"] == model.removesuffix("-fast"), "Incorrect provider model translation"
            if model.endswith("-fast"):
                assert request.get("serviceTier") == "priority", "Fast model lost priority service tier"


def check_events(events: list[dict], expected: dict, case: str) -> None:
    assert events, "Missing runtime trace"
    instructions = [e for e in events if e["kind"] == "instructions" and e["parent"]]
    assert instructions and all(e["loaded"] == expected["instructions_enabled"] for e in instructions), "Wrong instruction treatment"
    assert not any(e["kind"] in ("denied", "model-error", "budget-exceeded") for e in events), "Runtime failure or forbidden operation"
    assert not any(e.get("error") for e in events if e["kind"] == "result"), "A tool failed"
    check_models(events, expected)
    parents = calls(events)
    finals = completed(events, True)
    assert finals, "No response"
    final = finals[-1]["text"]
    all_spawns = calls(events, "subagent")
    spawns = [e for e in all_spawns if not e["input"].get("resume")]
    if case in ("direct", "routine"):
        assert not any(e["tool"] in ("subagent", "assess_subagent_checkpoint", "steer_subagent", "eval_gate") for e in parents), "Unnecessary orchestration"
        if case == "routine":
            assert json.loads(final).get("intervene") is False, "Routine update incorrectly requires intervention"
        else:
            reads = [e for e in parents if e["tool"] == "read" and Path(e["input"]["path"]).name == "assigned.txt"]
            assert reads, "No direct read"
            matches = [e for e in events if e["kind"] == "result" and e["id"] == reads[-1]["id"]]
            assert matches and expected["assigned"] in matches[-1]["text"] and events.index(matches[-1]) < events.index(finals[-1]), "Direct read result missing or after final"
            assert expected["assigned"] in final, "Missing verified file content"
        return
    for spawn in all_spawns:
        assert "model" not in spawn["input"] and "thinking" not in spawn["input"], "Specialist model override"
    # Read-before-action references and the copied swarm skill are context, not task work.
    assert not any(
        e["tool"] in ("read", "grep", "find", "ls")
        and not is_instruction_reference(e["input"].get("path"), expected)
        and not is_swarm_skill_read(e["input"].get("path"))
        for e in parents
    ), "Parent repeated delegated work"
    if case == "steering":
        check_steering(events, expected, spawns, final)
        return
    if case.startswith("selection-") or case == "delegation":
        role = case.removeprefix("selection-") if case.startswith("selection-") else "explore"
        assert len(spawns) == 1 and spawns[0]["input"]["subagent_type"] == role, "Wrong specialist selection"
        target = {"explore": "badge.ts", "debug": "ratio.ts", "review": "access.ts"}[role]
        read, _ = child_source_evidence(events, target)
        if case == "delegation":
            assert 1 <= spawns[0]["input"].get("max_turns", 0) <= 8, "Worker budget missing or excessive"
            prompt = spawns[0]["input"]["prompt"].lower()
            assert "src" in prompt and "renderbadge" in prompt, "Delegation omitted target or known context"
            assert re.search(r"read.only|do not (?:edit|modify)|no (?:edits|writes)", prompt), "Delegation omitted read-only constraint"
            assert "line" in prompt and "export" in prompt and re.search(r"verif|confirm|check", prompt), "Delegation omitted output or verification criteria"
            assert re.search(r"(?:no|not|never).{0,60}(?:command|shell|execut)", prompt), "Delegation omitted command restriction"
            assert "renderBadge" in final and "badge.ts" in final, "Parent did not integrate discovery"
        elif role == "explore":
            assert "renderBadge" in final and "badge.ts" in final, "Missing discovered symbol"
        elif role == "debug":
            assert "0" in final and ("NaN" in final or "zero" in final.lower()), "Missing failure diagnosis"
        else:
            assert "owner" in final.lower() and ("!==" in final or "invert" in final.lower()), "Missing access-control finding"
        assert events.index(read) > events.index(spawns[0]), "Worker read predates delegation"
        return
    if case == "parallel":
        assert len(spawns) == 2 and all(e["input"].get("run_in_background") is True for e in spawns), "Independent work was not launched in parallel"
        arrivals = [e for e in events if e["kind"] == "barrier-arrived"]
        passes = [e for e in events if e["kind"] == "barrier-passed"]
        assert len(arrivals) == len(passes) == 2 and {e["key"] for e in arrivals} == {"left", "right"}, "Missing two-worker overlap evidence"
        assert len({e["session"] for e in arrivals}) == 2, "One worker impersonated both branches"
        assert max(map(events.index, arrivals)) < min(map(events.index, passes)), "Independent worker lifetimes did not overlap"
        for key in ("left", "right"):
            read, _ = child_read(events, key + ".txt", expected[key])
            arrival = next(e for e in arrivals if e["key"] == key)
            assert read["session"] == arrival["session"], "Barrier does not identify the file's worker"
            assert all(Path(e["input"]["path"]).name == key + ".txt" for e in calls(events, "read", False) if e["session"] == read["session"]), "Worker crossed independent ownership"
            assert expected[key] in final, "Parallel result omitted"
        return
    if case == "dependency":
        assert len(spawns) == 2, "Expected discovery followed by dependent worker"
        _, first_final = child_read(events, "discover.txt", expected["handoff"])
        assert events.index(first_final) < events.index(spawns[1]), "Dependent worker started before prerequisite completed"
        assert expected["handoff"] in spawns[1]["input"]["prompt"], "Dependency evidence not passed forward"
        read, second_final = child_read(events, "dependent.txt")
        assert read["session"] != first_final["session"] and expected["handoff"] in second_final["text"], "Dependent worker did not use the handoff"
        assert expected["handoff"] in final, "Missing integrated handoff"
        return
    if case == "resume":
        assert len(spawns) == 1 and len(all_spawns) == 2, "Continuation spawned a fresh worker"
        resume = next(e for e in all_spawns if e["input"].get("resume"))
        assert resume["input"]["resume"] == worker_id(events, spawns[0]), "Wrong resume ID"
        first_read, first_final = child_read(events, "first.txt", expected["first"])
        second_read, _ = child_read(events, "second.txt", expected["second"])
        assert first_read["session"] == second_read["session"], "Resume did not reuse the worker session"
        first_reports = [e for e in completed(events, False) if expected["first"] in e["text"]]
        assert any(events.index(e) < events.index(resume) for e in first_reports), "Resume preceded the first completed report"
        assert expected["first"] in final and expected["second"] in final, "Continuation evidence omitted"
        return
    if case in ("material", "blocker"):
        assert len(spawns) == 1, "Unexpected expansion after worker evidence"
        key = "finding" if case == "material" else "blocker"
        _, report = child_read(events, key + ".txt", expected[key])
        decision = json.loads(final)
        assert expected[key] in json.dumps(decision.get("evidence")), "Decision not grounded in worker evidence"
        if case == "material":
            assert decision.get("decision") == "revise-design" and decision.get("streaming_supported") is False, "Material finding did not change the design decision"
        else:
            assert decision.get("decision") == "needs-input" and decision.get("account_id") is None, "Blocker was ignored or missing input fabricated"
        assert events.index(report) < events.index(finals[-1]), "Parent decided before worker evidence"
        # The real instruction says may call. If used, it must reflect the actual
        # checkpoint, but omission is not scored as failure or hidden by a mock.
        for assessment in calls(events, "assess_subagent_checkpoint"):
            assert events.index(report) < events.index(assessment), "Checkpoint assessed before evidence"
            assert assessment["input"]["agentId"] == worker_id(events, spawns[0]), "Wrong checkpoint worker"
            assert assessment["input"]["checkpointKind"] == ("material-finding" if case == "material" else "blocker"), "Wrong checkpoint classification"
        return
    raise AssertionError(f"Unknown case: {case}")


def check_steering(events, expected, spawns, final):
    assessments = calls(events, "assess_subagent_checkpoint")
    steers = calls(events, "steer_subagent")
    assert len(spawns) == len(assessments) == len(steers) == 1, "Expected one spawn, assessment, and steer"
    spawn, assessment, steer = spawns[0], assessments[0], steers[0]
    assert spawn["input"].get("run_in_background") is True, "Worker must remain available for steering"
    assert 1 <= spawn["input"].get("max_turns", 0) <= 8, "Worker budget missing or excessive"
    agent_id = worker_id(events, spawn)
    assert assessment["input"]["agentId"] == steer["input"]["agent_id"] == agent_id, "Checkpoint/steer addressed the wrong worker"
    assert assessment["input"]["checkpointKind"] == "scope-change", "Wrong checkpoint classification"
    assessed = result_for(events, assessment)
    assert json.loads(assessed["text"])["status"] == "assessed", "Live classifier assessment unavailable or abstained; not a steering pass"
    ready = next(e for e in events if e["kind"] == "checkpoint-ready")
    released = next(e for e in events if e["kind"] == "released")
    assert released["agentId"] == agent_id and released["child"] == ready["session"], "Wrong child released"
    order = [events.index(e) for e in (ready, assessment, assessed, steer, released)]
    assert order == sorted(set(order)), "Incorrect checkpoint/assessment/steering order"
    reads = calls(events, "read", False)
    assert reads and all(e["session"] == ready["session"] for e in reads), "Missing target worker read"
    assert all(events.index(e) > events.index(released) and Path(e["input"]["path"]).name == "assigned.txt" for e in reads), "Worker ignored the narrowed scope or read before steering"
    _, report = child_read(events, "assigned.txt", expected["assigned"])
    marker = next(e["marker"] for e in events if e["kind"] == "challenge")
    assert marker not in spawn["input"]["prompt"], "Marker leaked before steering"
    assert marker in steer["input"]["message"] and marker in report["text"], "Worker did not acknowledge steering-only marker"
    assert expected["assigned"] in final, "Parent did not integrate the worker result"


def check(case: str | None = None) -> None:
    root = Path(os.environ["ORCHESTRATION_EVAL_RUN"])
    latest = json.loads((root / "latest.json").read_text())
    assert latest["exit_code"] == 0, "Pi invocation failed"
    trace = Path(latest["trace"])
    assert trace.parent == root, "Trace outside this run"
    events = [json.loads(line) for line in trace.read_text().splitlines()]
    expected = json.loads(trace.with_suffix(".expected.json").read_text())
    case = case or expected["case"]
    assert isinstance(case, str), "Missing scenario ID"
    summary = {"case": case, "checkpoint_calls": len(calls(events, "assess_subagent_checkpoint")),
               "instruction_reference_reads": instruction_reference_reads(events, expected),
               "missing_turn_budgets": sum("max_turns" not in call["input"] for call in calls(events, "subagent")),
               "passed": False}
    try:
        check_events(events, expected, case)
        summary["passed"] = True
    finally:
        trace.with_suffix(".assessment.json").write_text(json.dumps(summary))
