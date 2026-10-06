"""Offline production-config fixtures shared by the Caliper runner tests."""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVAL = ROOT / ".pi/agent/evals/orchestration"
ROLES = ("quick", "explore", "analyze", "debug", "review", "validate", "test")


def seed_repo(repo: Path) -> Path:
    agent = repo / ".pi/agent"
    fixture = agent / "evals/orchestration"
    fixture.mkdir(parents=True)
    for name in ("check.py", "launch.py", "model_config.py", "scenario.py"):
        shutil.copy2(EVAL / name, fixture / name)
    for path in (
        agent / "npm/node_modules/@gotgenes/pi-subagents/src/index.ts",
        agent / "extensions/openai-capabilities.ts",
        agent / "extensions/instruction-fragments.ts",
        agent / "extensions/recommend-agent/index.ts",
        fixture / "fixture.ts",
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("// offline extension fixture\n")
    (agent / "npm/node_modules/@gotgenes/pi-subagents/package.json").write_text('{"version":"21.7.1"}')
    (agent / "settings.json").write_text(json.dumps({
        "defaultProvider": "openai-codex",
        "defaultModel": "mock-parent-fast",
        "defaultThinkingLevel": "xhigh",
        "packages": ["unrelated-package"],
    }))
    (agent / "models.json").write_text('{"providers":{"openai-codex":{"models":[]}}}')
    (agent / "models-store.json").write_text(json.dumps({
        "openai-codex": {"models": [
            {"id": f"mock-{name}", "provider": "openai-codex",
             "baseUrl": "https://example.invalid", "api": "openai-codex-responses"}
            for name in ("parent-fast", *ROLES)
        ]}
    }))
    (agent / "agents").mkdir()
    for role in ROLES:
        (agent / "agents" / f"{role}.md").write_text(
            f"---\ndescription: The {role} specialist\nmodel: openai-codex/mock-{role}\n"
            "thinking: low\n---\nOriginal production prompt.\n"
        )
    instructions = agent / "instructions/orchestration"
    instructions.mkdir(parents=True)
    instruction_files = {
        "index.md": "---\nwhen:\n  tools:\n    any: [subagent]\n---\n# Subagent orchestration\n",
        "assignments.md": "# Assignment reference\n",
        "coordination.md": "# Coordination reference\n",
        "routing.md": "# Routing reference\n",
        "supervision.md": "# Supervision reference\n",
    }
    for name, content in instruction_files.items():
        (instructions / name).write_text(content)
    (fixture / "orchestration.eval.yaml").write_text("skills: []\ntasks: []\n")
    swarm = repo / ".agents/skills/swarm"
    swarm.mkdir(parents=True)
    (swarm / "SKILL.md").write_text("# Offline swarm fixture\n")
    return repo
