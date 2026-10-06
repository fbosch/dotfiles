#!/usr/bin/env python3
"""Isolated Caliper runtime using production model and specialist presets."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

sys.path.insert(0, str(Path(__file__).parent))

def load_sibling(name: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(f"{name}.py"))
    if spec is None or spec.loader is None:
        raise ImportError(f"Missing eval module: {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module




scenarios = load_sibling("scenario")
CASES = scenarios.CASES
seed_fixture = scenarios.seed_fixture


def prepare(repo: Path, run_root: Path, evidence: Path, without: bool,
            model: str = "configured", thinking: str = "configured") -> None:
    fixture = repo / ".pi/agent/evals/orchestration"
    agent = repo / ".pi/agent"
    model_config = load_sibling("model_config")
    catalog = model_config.load_catalog(repo)
    chosen, level = model_config.resolve_parent(repo, model, thinking)
    preset = next(entry for entry in [catalog["parent"], *catalog["agents"].values()]
                  if (entry["model"], entry["thinking"]) == (chosen, level))
    catalog["parent"] = {key: preset[key] for key in ("model", "thinking", "source")}
    extensions = [
        agent / "npm/node_modules/@gotgenes/pi-subagents/src/index.ts",
        agent / "extensions/openai-capabilities.ts",
        agent / "extensions/instruction-fragments.ts",
        agent / "extensions/recommend-agent/index.ts",
        fixture / "fixture.ts",
    ]
    for path in extensions:
        if not path.is_file():
            raise ValueError(f"Required extension not installed: {path}")
    evidence.mkdir(parents=True, exist_ok=True)
    shutil.copy2(fixture / "check.py", evidence / "check.py")
    instruction_source = agent / "instructions/orchestration"
    instruction_files = sorted(instruction_source.glob("*.md"))
    if not (instruction_source / "index.md").is_file():
        raise ValueError(f"Missing orchestration instruction entrypoint: {instruction_source / 'index.md'}")
    instruction_snapshot = evidence / "instructions/orchestration"
    instruction_hashes = {}
    for source in instruction_files:
        relative = source.name
        target = instruction_snapshot / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        instruction_hashes[f"orchestration/{relative}"] = hashlib.sha256(source.read_bytes()).hexdigest()
    models = json.loads((agent / "models.json").read_text())
    if any(set(provider) != {"models"} for provider in models.get("providers", {}).values()):
        raise ValueError("Review model configuration before copying provider endpoints or credentials into an eval")
    (evidence / "models.json").write_text(json.dumps(models, indent=2))
    (evidence / "catalog.json").write_text(json.dumps(catalog, indent=2))
    (evidence / "models-store.json").write_text(json.dumps(model_config.snapshot_store(repo, catalog), indent=2))
    package = agent / "npm/node_modules/@gotgenes/pi-subagents/package.json"
    metadata = {
        "instructions_enabled": not without,
        "instruction_sha256": instruction_hashes,
        "extensions": {str(p.relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest() for p in extensions},
        "subagents_version": json.loads(package.read_text())["version"],
        "catalog": catalog,
        "protocol": "production-model-orchestration-v2",
    }
    (evidence / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    config = {**metadata, "evidence": str(evidence), "extensions": list(map(str, extensions)),
              "swarm": str(repo / ".agents/skills/swarm")}
    (run_root / "orchestration.json").write_text(json.dumps(config))
    for name in ("model_config.py", "scenario.py"):
        shutil.copy2(fixture / name, run_root / name)
    shutil.copy2(__file__, run_root / "orchestration-launch.py")
    (run_root / "home/.pi/agent/settings.json").write_text("{}\n")


def configure_attempt(home: Path, agent: Path, config: dict, trace: Path, case: str = "direct") -> Path:
    if agent.resolve() != (home / ".pi/agent").resolve():
        raise ValueError("Unexpected Caliper agent directory")
    work = home / "fixture"
    work.mkdir(parents=True, exist_ok=False)
    expected = seed_fixture(work, case)
    catalog = config["catalog"]
    settings = {
        "packages": [], "extensions": config["extensions"], "skills": [], "prompts": [],
        "defaultProjectTrust": "always", "classifier": {"recommendAgent": {"enabled": True}},
    }
    agent.mkdir(parents=True, exist_ok=True)
    (agent / "settings.json").write_text(json.dumps(settings))
    (agent / "subagents.json").write_text('{"maxConcurrent":3,"abortAllOnInterrupt":true}\n')
    shutil.copy2(Path(config["evidence"]) / "models.json", agent / "models.json")
    shutil.copy2(Path(config["evidence"]) / "models-store.json", agent / "models-store.json")
    instruction_directory = agent / "instructions/orchestration"
    instruction_directory.mkdir(parents=True, exist_ok=True)
    if config["instructions_enabled"]:
        shutil.copytree(Path(config["evidence"]) / "instructions/orchestration", instruction_directory, dirs_exist_ok=True)
    (agent / "agents").mkdir(exist_ok=True)
    # Separate directories avoid Explore.md/explore.md collisions on macOS while
    # retaining the native registry's case-sensitive canonical agent names.
    disabled = work / ".pi/agents"
    disabled.mkdir(parents=True)
    for name in ("Explore", "Plan", "general-purpose"):
        (disabled / f"{name}.md").write_text("---\nenabled: false\n---\n")
    for name, definition in catalog["agents"].items():
        # Preserve role descriptions and execution presets. Bodies are bounded
        # fixture instructions, not an evaluation of production skill prompts.
        (agent / "agents" / f"{name}.md").write_text(
            "---\n" + f"description: {json.dumps(definition['description'])}\n"
            "prompt_mode: replace\n" + f"model: {definition['model']}\n"
            f"thinking: {definition['thinking']}\n"
            "max_turns: 8\ntools: read, grep, find, ls, eval_gate\n---\n"
            f"You are the {name} specialist. {definition['description']}\n"
            "Perform only the assigned read-only task. Cite files and evidence. "
            "Do not edit or execute shell commands. Report new evidence or blockers to the parent. "
            "Do not invent missing input or claim unsupported capabilities. "
            "If your assignment requests a controlled gate, call eval_gate(action=wait) first; "
            "after it returns follow the parent's steering before reading. "
            "If a fixture file asks for a barrier, call eval_gate(action=barrier,key=...) before finishing.\n"
        )
    swarm = Path(config["swarm"])
    if swarm.is_dir():
        shutil.copytree(swarm, home / ".agents/skills/swarm")
    instruction_reference_files = sorted(
        path.name for path in instruction_directory.glob("*.md")
    ) if config["instructions_enabled"] else []
    expected.update(
        instructions_enabled=config["instructions_enabled"],
        instruction_reference_files=instruction_reference_files,
        catalog=catalog,
    )
    trace.with_suffix(".expected.json").write_text(json.dumps(expected))
    return work


def extract_case(args: list[str]) -> tuple[str, list[str]]:
    if not args:
        raise ValueError("Missing Pi invocation")
    match = re.match(r"\[\[orchestration-case:([a-z-]+)\]\]\s*", args[-1])
    if not match or match[1] not in CASES:
        raise ValueError("Orchestration spec must declare a supported case marker")
    return match[1], [*args[:-1], args[-1][match.end():]]


def launch(pi: str, args: list[str]) -> int:
    config = json.loads(Path(__file__).with_name("orchestration.json").read_text())
    evidence = Path(config["evidence"])
    (evidence / "latest.json").unlink(missing_ok=True)
    home = Path(os.environ["HOME"])
    agent_value = os.environ.get("PI_CODING_AGENT_DIR")
    if not agent_value or "--version" in args or "-v" in args:
        return subprocess.call([pi, "--no-extensions", *args], env={**os.environ, "PI_OFFLINE": "1"})
    case, args = extract_case(args)
    trace = evidence / f"attempt-{uuid.uuid4().hex}.jsonl"
    work = configure_attempt(home, Path(agent_value), config, trace, case)
    env = {**os.environ, "PI_OFFLINE": "1", "ORCHESTRATION_TRACE": str(trace),
           "ORCHESTRATION_WORK": str(work), "ORCHESTRATION_CASE": case,
           "ORCHESTRATION_MODEL_CATALOG": str(evidence / "catalog.json")}
    result = subprocess.call([pi, "--no-skills", "--no-prompt-templates", *args], cwd=work, env=env)
    (evidence / "latest.json").write_text(json.dumps({"trace": str(trace), "exit_code": result}))
    return result


if __name__ == "__main__":
    if sys.argv[1] == "prepare":
        prepare(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), sys.argv[5] == "true", *sys.argv[6:8])
    else:
        raise SystemExit(launch(sys.argv[1], sys.argv[2:]))
