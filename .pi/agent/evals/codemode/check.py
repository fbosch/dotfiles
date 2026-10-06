"""Deterministic grading of native codemode tool execution and fixture artifacts."""
import json
import os
import re
from pathlib import Path


def validate(events: list[dict], expected: dict) -> None:
    case = expected["case"]
    assert not any(e["kind"] in {"denied", "budget-exceeded"} for e in events), "Denied tool or exceeded turn budget"
    execution = [e for e in events if e["kind"] == "execution"]
    assert execution and all(e["model"] == expected["model"] and e["thinking"] == expected["thinking"] for e in execution), "Unexpected model/thinking"
    assert all(e.get("ruleLoaded") and "codemode" in e.get("tools", []) for e in execution), "Rule or codemode tool was not loaded"
    finals = [e for e in events if e["kind"] == "assistant" and not e["hasToolCalls"] and e["stopReason"] == "stop"]
    assert finals, "No successful final answer"
    final = finals[-1]["text"]
    scripts = [e for e in events if e["kind"] == "script"]
    results = [e for e in events if e["kind"] == "script-result"]
    assert len(results) == len(scripts) and not any(e["error"] for e in results), "Unfinished or failed script"
    starts = [e for e in events if e["kind"] == "start"]
    ends = [e for e in events if e["kind"] == "end"]
    assert len(starts) == len(ends), "Started tool did not settle"
    for start in starts:
        end = next((e for e in ends if e["id"] == start["id"]), None)
        assert end and events.index(start) < events.index(end), "Missing or out-of-order tool completion"
        if start.get("scriptId"):
            result = next((e for e in results if e["id"] == start["scriptId"]), None)
            assert result and events.index(end) < events.index(result), "Script finished before nested call settled"
    artifact = next((e for e in reversed(events) if e["kind"] == "artifacts"), None)
    assert artifact, "Missing fixture artifact snapshot"
    for path, content in expected["contents"].items():
        if case != "mutations" or path != "config.json":
            assert artifact["files"][path] == content, f"Unauthorized file change: {path}"
    def values(pairs):
        for name, value in pairs:
            assert re.search(rf"\b{name}\b[^\n]{{0,60}}\b{value}\b", final), f"Final answer missing {name} = {value}"
    if case == "single":
        assert not scripts, "Single trivial read used codemode"
        assert len(starts) == 1 and starts[0]["tool"] == "read" and starts[0]["path"] == "a.ts"
        values([("alpha", 1)])
        return
    if case == "mutations":
        assert all(e["tool"] in {"read", "write"} and e.get("path") == "config.json" for e in starts)
        writes = [e for e in starts if e["tool"] == "write"]
        assert len(writes) == 2, "Expected two ordered mutations"
        first_end = next(e for e in ends if e["id"] == writes[0]["id"])
        between = [e for e in starts if e["tool"] == "read" and events.index(first_end) < events.index(e) < events.index(writes[1])]
        assert between, "Missing read-back after first mutation"
        assert all(events.index(next(e for e in ends if e["id"] == read["id"])) < events.index(writes[1]) for read in between)
        assert json.loads(writes[0]["content"]) == {"enabled": True, "mode": "slow", "keep": "untouched"}
        assert json.loads(artifact["files"]["config.json"]) == {"enabled": True, "mode": "fast", "keep": "untouched"}
        assert all(not any(n > 1 for n in e.get("batches", [])) for e in results), "Conflicting mutations were batched"
        assert all(value in final.lower() for value in ["true", "fast", "untouched"]), "Final configuration not reported"
        return
    target = ["check_one", "check_two"] if case == "tool-error" else (["large.ts", "small.ts"] if case == "large" else ["a.ts", "b.ts", "c.ts"] if case == "rejected" else ["a.ts", "b.ts"])
    selected = [e for e in starts if (e["tool"] if case == "tool-error" else e.get("path")) in target]
    assert len(selected) == len(target) and {e["tool"] if case == "tool-error" else e["path"] for e in selected} == set(target), "Missing or repeated target calls"
    assert all(e.get("scriptId") for e in selected) and len({e["scriptId"] for e in selected}) == 1, "Independent calls were not in one codemode script"
    cohort_ends = [e for e in ends if e["id"] in {s["id"] for s in selected}]
    assert max(events.index(e) for e in selected) < min(events.index(e) for e in cohort_ends), "Independent calls ran sequentially"
    result = next(e for e in results if e["id"] == selected[0]["scriptId"])
    assert len(target) in result.get("batches", []), "No executed and completed allSettled batch of the required size"
    if case == "dependent":
        manifests = [e for e in starts if e.get("path") == "manifest.json"]
        assert len(manifests) == 1, "Missing manifest read"
        end = next(e for e in ends if e["id"] == manifests[0]["id"])
        assert end["success"] and events.index(end) < min(events.index(e) for e in selected), "Source reads preceded prerequisite"
    allowed_count = len(target) + (1 if case == "dependent" else 0)
    assert len(starts) == allowed_count, "Unrelated tool calls"
    if case in {"independent", "dependent"}:
        values([("alpha", 1), ("beta", 2)])
        assert "a.ts" in final and "b.ts" in final, "Values not attributed to files"
    elif case == "rejected":
        values([("alpha", 1), ("gamma", 3)])
        assert "b.ts" in final and "permission denied" in final.lower(), "Failure not attributed"
        assert not next(e for e in cohort_ends if e["path"] == "b.ts")["success"]
    elif case == "tool-error":
        final = re.sub(r"\bcheck[ _-]+one\b", "check_one", final, flags=re.I)
        final = re.sub(r"\bcheck[ _-]+two\b", "check_two", final, flags=re.I)
        assert "check_one" in final and "check_two" in final and "invalid configuration" in final.lower()
        assert re.search(r"check_one[^\n]{0,60}(pass|success)", final, re.I), "Successful check not reported"
        assert re.search(r"check_two[^\n]{0,60}(fail|error)", final, re.I), "Fulfilled error misreported as success"
    elif case == "large":
        values([("large", 5), ("small", 4)])
        output = "\n".join(e["text"] for e in results) + final
        assert len(output) < 8000 and "BULK_CONTENT_OMIT" not in output and "Full output:" not in output, "Bulk output was printed or spilled"
        assert all(value in output for value in ["large.ts", "small.ts", "aaaa"]), "Missing path/anchor attribution"
        assert output.count("export const large = 5;") <= 2 and output.count("export const small = 4;") <= 2, "Duplicated structured read output"


def check() -> None:
    run = Path(os.environ["CODEMODE_EVAL_RUN"])
    latest = json.loads((run / "latest.json").read_text())
    assert latest["exit_code"] == 0, "Pi attempt failed before grading"
    trace = Path(latest["trace"])
    expected = json.loads(trace.with_suffix(".expected.json").read_text())
    events = [json.loads(line) for line in trace.read_text().splitlines()]
    verdict = {"case": expected["case"], "arm": expected["arm"], "trace": str(trace)}
    try:
        validate(events, expected)
    except AssertionError as error:
        trace.with_suffix(".verdict.json").write_text(json.dumps({**verdict, "pass": False, "reason": str(error)}))
        raise
    trace.with_suffix(".verdict.json").write_text(json.dumps({**verdict, "pass": True}))
