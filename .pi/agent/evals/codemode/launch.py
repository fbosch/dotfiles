#!/usr/bin/env python3
"""Caliper launcher for isolated native codemode instruction comparisons."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

CASES = {"independent", "dependent", "rejected", "tool-error", "mutations", "large", "large-edit", "single",
         "references", "mixed-search", "separate-checks", "ordered-checks", "direct-checks"}


def resolve_model(repo: Path, model: str = "configured", thinking: str = "configured") -> tuple[str, str]:
    # This fixture launches no specialists, so their virtual presets are irrelevant.
    agent = repo / ".pi/agent"
    settings = json.loads((agent / "settings.json").read_text())
    if model == "configured":
        model = f'{settings.get("defaultProvider", "")}/{settings.get("defaultModel", "")}'
    elif "/" not in model:
        model = f'{settings.get("defaultProvider", "")}/{model}'
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.:-]+", model):
        raise ValueError("Codemode eval requires a physical provider/model")
    thinking = settings.get("defaultThinkingLevel") if thinking == "configured" else thinking
    if thinking not in {"off", "minimal", "low", "medium", "high", "xhigh", "max"}:
        raise ValueError(f"Invalid thinking level: {thinking}")
    provider, model_id = model.split("/", 1)
    store = json.loads((agent / "models-store.json").read_text())
    custom = json.loads((agent / "models.json").read_text()).get("providers", {})
    registered = [*store.get(provider, {}).get("models", []), *custom.get(provider, {}).get("models", [])]
    if not any(entry.get("id") == model_id for entry in registered):
        raise ValueError(f"Model is absent from production catalogs: {model}")
    return model, thinking


def prepare(repo: Path, run_root: Path, evidence: Path, baseline: bool, model: str, thinking: str) -> None:
    source = repo / ".pi/agent/evals/codemode"
    evidence.mkdir(parents=True, exist_ok=True)
    agent = repo / ".pi/agent"
    # Retain production model metadata and priority-tier routing without loading personal extensions.
    spec = importlib.util.spec_from_file_location("codemode_model_config", repo / ".pi/agent/evals/orchestration/model_config.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    catalog = {"parent": {"model": model}, "agents": {}}
    models = json.loads((agent / "models.json").read_text())
    if any(set(provider) != {"models"} for provider in models.get("providers", {}).values()):
        raise ValueError("Review credential-bearing custom provider configuration before copying")
    (evidence / "models.json").write_text(json.dumps(models))
    (evidence / "models-store.json").write_text(json.dumps(module.snapshot_store(repo, catalog)))
    # Freeze the original rule so relocating production guidance does not change the control arm.
    guidance = (source / "baseline.md").read_text().rstrip("\n")
    if not guidance.strip():
        raise ValueError("Baseline codemode guidance is empty")
    candidate_path = Path(os.environ.get("CODEMODE_EVAL_CANDIDATE", source / "candidate.md")).resolve()
    candidate = candidate_path.read_text()
    if not candidate.strip():
        raise ValueError("Candidate codemode guidance is empty")
    (evidence / "baseline.md").write_text(guidance + "\n")
    (evidence / "candidate.md").write_text(candidate)
    files = [source / "fixture.ts", source / "request.ts", source / "check.py", source / "launch.py", source / "codemode.eval.yaml", agent / "extensions/openai-capabilities.ts"]
    metadata = {"arm": "baseline" if baseline else "candidate", "model": model, "thinking": thinking,
                "baseline_sha256": hashlib.sha256(guidance.encode()).hexdigest(),
                "candidate_sha256": hashlib.sha256(candidate.encode()).hexdigest(),
                "candidate_source": str(candidate_path),
                "source_sha256": {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
                "capture_prompt": os.environ.get("CODEMODE_TRACE_PROMPT") == "1",
                "tool_routing_guidance": os.environ.get("CODEMODE_EVAL_TOOL_ROUTING") == "1",
                "typed_outputs": os.environ.get("CODEMODE_EVAL_TYPED_OUTPUTS") == "1",
                "scope": "isolated tools and shared base prompt; not a full personal-extension-stack eval"}
    (evidence / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    shutil.copy2(source / "check.py", evidence / "check.py")
    (run_root / "codemode.json").write_text(json.dumps({**metadata, "evidence": str(evidence),
        "extensions": [str(agent / "extensions/openai-capabilities.ts"), str(source / "fixture.ts")]}))
    shutil.copy2(__file__, run_root / "codemode-launch.py")
    (run_root / "home/.pi/agent/settings.json").write_text("{}\n")


def configure_attempt(home: Path, agent: Path, config: dict, trace: Path, case: str) -> Path:
    if agent.resolve() != (home / ".pi/agent").resolve():
        raise ValueError("Unexpected Caliper agent directory")
    work = home / "fixture"
    work.mkdir(parents=True, exist_ok=False)
    contents = {"a.ts": "export const alpha = 1;\n", "b.ts": "export const beta = 2;\n",
                "c.ts": "export const gamma = 3;\n", "small.ts": "export const small = 4;\n",
                "manifest.json": '{"files":["a.ts","b.ts"]}\n',
                "policy.md": "policy = scoped\n",
                "validation.md": "validation = readback\n",
                "runtime.md": "runtime = installed\n",
                "config.json": '{"enabled":false,"mode":"slow","keep":"untouched"}\n',
                "config-large.json": json.dumps({"enabled": False, "mode": "slow", "padding": "x" * 80_000}) + "\n",
                "large.ts": "export const large = 5;\n" + "// BULK_CONTENT_OMIT " + "x" * 80_000 + "\n"}
    for name, text in contents.items():
        (work / name).write_text(text)
    evidence = Path(config["evidence"])
    agent.mkdir(parents=True, exist_ok=True)
    (agent / "settings.json").write_text(json.dumps({"packages": [], "extensions": [
        "-builtin:mcp", "-builtin:tool-search", "-builtin:codemode", *config["extensions"]],
        "skills": [], "prompts": [], "defaultProjectTrust": "never", "defaultTools": [
        "read", "write", "check_one", "check_two", "codemode"], "codemode": {"mode": "on"}}))
    for name in ("models.json", "models-store.json"):
        shutil.copy2(evidence / name, agent / name)
    rule = (evidence / ("baseline.md" if config["arm"] == "baseline" else "candidate.md")).read_text()
    (agent / "SYSTEM.md").write_text(
        "You are a coding assistant working in an isolated fixture. Use the available tools to complete the user task. "
        "Do not guess file contents, make unrelated calls, or change files unless requested. "
        "Tool definitions specify their output contracts. Report actual results, including failures.\n\n" + rule)
    trace.with_suffix(".expected.json").write_text(json.dumps({"case": case, "arm": config["arm"],
        "contents": contents, "work": str(work), "model": config["model"], "thinking": config["thinking"]}))
    return work


def launch(pi: str, args: list[str]) -> int:
    config = json.loads(Path(__file__).with_name("codemode.json").read_text())
    if not os.environ.get("PI_CODING_AGENT_DIR") or "--version" in args or "-v" in args:
        return subprocess.call([pi, "--no-extensions", *args], env={**os.environ, "PI_OFFLINE": "1"})
    match = re.match(r"\[\[codemode-case:([a-z-]+)\]\]\s*", args[-1])
    if not match or match[1] not in CASES:
        raise ValueError("Spec must provide a supported codemode case marker")
    case = match[1]
    args = [*args[:-1], args[-1][match.end():]]
    evidence = Path(config["evidence"])
    latest = evidence / "latest.json"
    latest.unlink(missing_ok=True)
    trace = evidence / f"attempt-{uuid.uuid4().hex}.jsonl"
    work = configure_attempt(Path(os.environ["HOME"]), Path(os.environ["PI_CODING_AGENT_DIR"]), config, trace, case)
    env = {**os.environ, "PI_OFFLINE": "1", "CODEMODE_EVAL_TYPED_OUTPUTS": "1" if config.get("typed_outputs") else "0", "CODEMODE_EVAL_TOOL_ROUTING": "1" if config.get("tool_routing_guidance") else "0", "CODEMODE_TRACE_PROMPT": "1" if config.get("capture_prompt") else "0", "CODEMODE_TRACE": str(trace), "CODEMODE_WORK": str(work), "CODEMODE_CASE": case, "CODEMODE_RULE": str(evidence / ("baseline.md" if config["arm"] == "baseline" else "candidate.md"))}
    result = subprocess.call([pi, "--no-builtin-tools", "--no-skills", "--no-prompt-templates", *args], cwd=work, env=env)
    latest.write_text(json.dumps({"trace": str(trace), "exit_code": result}))
    return result


if __name__ == "__main__":
    if sys.argv[1] == "prepare":
        prepare(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), sys.argv[5] == "true", *sys.argv[6:8])
    elif sys.argv[1] == "resolve":
        print(*resolve_model(Path(sys.argv[2]), *sys.argv[3:5]))
    else:
        raise SystemExit(launch(sys.argv[1], sys.argv[2:]))
