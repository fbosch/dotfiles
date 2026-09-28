"""Deterministic checks over extension-observed events, never final-text claims alone."""
import json
import os
from pathlib import Path
import re


def check_events(events: list[dict], expected: dict, case: str) -> None:
    assert events, "Missing runtime trace"
    instructions = [e for e in events if e["kind"] == "instructions" and e["parent"]]
    assert instructions and all(
        e["loaded"] == expected["instructions_enabled"] for e in instructions
    ), "Wrong instruction treatment"
    assert not any(e["kind"] == "denied" for e in events), "Candidate attempted a forbidden read"
    calls = [e for e in events if e["kind"] == "call"]
    results = {e["id"]: e for e in events if e["kind"] == "result"}
    assert not any(e.get("error") for e in results.values()), "A tool failed"
    parents = [e for e in calls if e["parent"]]
    completed = [e for e in events if e["kind"] == "assistant" and e.get("stopReason") == "stop" and e.get("hasToolCalls") is False]
    finals = [e["text"] for e in completed if e["parent"]]
    if case in ("direct", "routine"):
        assert not any(
            e["tool"] in ("subagent", "assess_subagent_checkpoint", "steer_subagent", "eval_gate")
            for e in calls
        ), "Unnecessary orchestration"
        if case == "direct":
            assert any(
                e["tool"] == "read" and Path(e["input"]["path"]).name == "assigned.txt"
                for e in parents
            ), "No direct read"
            assert finals and expected["assigned"] in finals[-1], "Missing verified file content"
            assert any(e["tool"] == "read" and expected["assigned"] in results.get(e["id"], {}).get("text", "") and events.index(results[e["id"]]) < events.index(completed[-1]) for e in parents), "Direct read result missing or after final"
        else:
            assert finals, "No response"
            assert json.loads(finals[-1]).get("intervene") is False, "Routine update incorrectly requires intervention"
        return

    assert case == "steering", f"Unknown case: {case}"
    spawns = [e for e in parents if e["tool"] == "subagent"]
    assessments = [e for e in parents if e["tool"] == "assess_subagent_checkpoint"]
    steers = [e for e in parents if e["tool"] == "steer_subagent"]
    assert len(spawns) == len(assessments) == len(steers) == 1, "Expected one spawn, assessment, and steer"
    spawn, assessment, steer = spawns[0], assessments[0], steers[0]
    assert spawn["input"].get("run_in_background") is True, "Worker must remain available for steering"
    assert 1 <= spawn["input"].get("max_turns", 0) <= 6, "Worker budget missing or excessive"
    match = re.search(r"Agent ID: ([\w.-]+)", results[spawn["id"]]["text"])
    assert match, "Native spawn did not return an agent ID"
    agent_id = match.group(1)
    assert assessment["input"]["agentId"] == steer["input"]["agent_id"] == agent_id, "Checkpoint/steer addressed the wrong worker"
    assert assessment["input"]["checkpointKind"] == "scope-change", "Wrong checkpoint classification"
    assessed = results[assessment["id"]]
    assert json.loads(assessed["text"])["status"] == "assessed", "Live Jev assessment unavailable or abstained; not a steering pass"
    ready = next(e for e in events if e["kind"] == "checkpoint-ready")
    released = next(e for e in events if e["kind"] == "released")
    assert released["agentId"] == agent_id and released["child"] == ready["session"], "Wrong child released"
    order = [events.index(e) for e in (ready, assessment, assessed, steer, released)]
    assert order == sorted(set(order)), "Incorrect checkpoint/assessment/steering order"
    child_reads = [e for e in calls if not e["parent"] and e["tool"] == "read"]
    assert child_reads and all(e["session"] == ready["session"] for e in child_reads), "Missing target worker read"
    assert all(
        events.index(e) > events.index(released)
        and Path(e["input"]["path"]).name == "assigned.txt"
        for e in child_reads
    ), "Worker ignored the narrowed scope or read before steering"
    assert all(expected["assigned"] in results.get(e["id"], {}).get("text", "") for e in child_reads), "Worker read result missing assigned content"
    assert not any(e["tool"] == "read" for e in parents), "Parent repeated delegated work"
    child_finals = [e for e in completed if e["session"] == ready["session"]]
    child_text = [e["text"] for e in child_finals]
    assert child_text and expected["assigned"] in child_text[-1], "Worker did not report the actual file content"
    assert all(events.index(results[e["id"]]) < events.index(child_finals[-1]) for e in child_reads), "Worker report precedes read results"
    challenge = next(e for e in events if e["kind"] == "challenge")
    marker = challenge["marker"]
    assert marker not in spawn["input"]["prompt"], "Marker leaked before steering"
    assert marker in steer["input"]["message"] and marker in child_text[-1], "Worker did not acknowledge steering-only marker"
    assert finals and expected["assigned"] in finals[-1], "Parent did not integrate the worker result"


def check(case: str) -> None:
    root = Path(os.environ["ORCHESTRATION_EVAL_RUN"])
    latest = json.loads((root / "latest.json").read_text())
    assert latest["exit_code"] == 0, "Pi invocation failed"
    trace = Path(latest["trace"])
    assert trace.parent == root, "Trace outside this run"
    events = [json.loads(line) for line in trace.read_text().splitlines()]
    expected = json.loads(trace.with_suffix(".expected.json").read_text())
    check_events(events, expected, case)
