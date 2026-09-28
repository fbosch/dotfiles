"""Resolve the eval's model settings from production configuration, not test defaults."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import sys

import yaml

AGENTS = ("quick", "explore", "analyze", "debug", "review", "validate", "test")
THINKING = {"off", "minimal", "low", "medium", "high", "xhigh", "max"}
MODEL = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.:-]+$")


def frontmatter(path: Path) -> dict:
    raw = path.read_text()
    if not raw.startswith("---\n"):
        raise ValueError(f"Missing frontmatter: {path}")
    parts = raw.split("---", 2)
    if len(parts) != 3:
        raise ValueError(f"Unterminated frontmatter: {path}")
    parsed = yaml.safe_load(parts[1])
    if not isinstance(parsed, dict):
        raise ValueError(f"Invalid frontmatter: {path}")
    return parsed


def load_catalog(repo: Path) -> dict:
    agent = repo / ".pi/agent"
    settings = json.loads((agent / "settings.json").read_text())
    build = settings.get("modes", {}).get("build", {})
    if not MODEL.fullmatch(str(build.get("model", ""))) or build.get("thinkingLevel") not in THINKING:
        raise ValueError("Configure modes.build.model and modes.build.thinkingLevel before evaluating orchestration")
    catalog = {}
    for name in AGENTS:
        source = agent / "agents" / f"{name}.md"
        override = repo / ".pi/agents" / f"{name}.md"
        if override.is_file():
            source = override
        definition = frontmatter(source)
        if definition.get("enabled") is False:
            continue
        model = definition.get("model")
        thinking = definition.get("thinking")
        if not isinstance(model, str) or not MODEL.fullmatch(model) or thinking not in THINKING:
            raise ValueError(f"{source}: explicit model and thinking settings required")
        catalog[name] = {
            "model": model,
            "thinking": thinking,
            "description": str(definition.get("description", name)),
            "source": str(source.relative_to(repo)),
            "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        }
    if "quick" not in catalog:
        raise ValueError("The controlled steering case requires an enabled quick agent")
    return {
        "parent": {"model": build["model"], "thinking": build["thinkingLevel"], "source": ".pi/agent/settings.json#modes.build"},
        "agents": catalog,
    }


def resolve_parent(repo: Path, model: str = "configured", thinking: str = "configured") -> tuple[str, str]:
    catalog = load_catalog(repo)
    parent = catalog["parent"]
    if model == "configured":
        model = parent["model"]
        default_thinking = parent["thinking"]
    else:
        if "/" not in model:
            model = "openai-codex/" + model
        options = [parent, *catalog["agents"].values()]
        matches = [entry for entry in options if entry["model"] == model]
        if not matches:
            raise ValueError(f"Model is not configured for build or an evaluated specialist: {model}")
        levels = {entry["thinking"] for entry in matches}
        if thinking == "configured" and len(levels) != 1:
            raise ValueError("This model has multiple configured thinking levels; specify one explicitly")
        default_thinking = matches[0]["thinking"]
    thinking = default_thinking if thinking == "configured" else thinking
    if thinking not in THINKING:
        raise ValueError(f"Invalid thinking level: {thinking}")
    presets = [parent, *catalog["agents"].values()]
    if not any(entry["model"] == model and entry["thinking"] == thinking for entry in presets):
        raise ValueError("Model/thinking pair is not a configured build or specialist preset")
    return model, thinking


def snapshot_store(repo: Path, catalog: dict) -> dict:
    from urllib.parse import urlsplit
    store = json.loads((repo / ".pi/agent/models-store.json").read_text())
    custom = json.loads((repo / ".pi/agent/models.json").read_text()).get("providers", {})
    references = [catalog["parent"]["model"], *(entry["model"] for entry in catalog["agents"].values())]
    selected = {}
    allowed = {"api", "baseUrl", "compat", "contextWindow", "cost", "id", "input", "inputLimits", "maxTokens", "name", "provider", "reasoning", "thinkingLevelMap", "type"}
    for reference in references:
        provider, model = reference.split("/", 1)
        entry = store.get(provider, {})
        source = next((m for m in entry.get("models", []) if m.get("id") == model), None)
        if source is None:
            if any(m.get("id") == model for m in custom.get(provider, {}).get("models", [])):
                continue
            raise ValueError(f"Exact configured model is absent from production catalogs: {reference}")
        if set(source) - allowed:
            raise ValueError(f"Review unexpected fields before snapshotting model: {reference}")
        url = urlsplit(source.get("baseUrl", ""))
        if url.username or url.password or url.query or url.fragment:
            raise ValueError("Refusing to snapshot credential-bearing model URL")
        metadata = {key: entry[key] for key in ("checkedAt", "lastModified", "etag") if key in entry}
        target = selected.setdefault(provider, {**metadata, "models": []})
        if not any(m["id"] == model for m in target["models"]):
            target["models"].append(source)
    return selected


if __name__ == "__main__":
    model, thinking = resolve_parent(Path(sys.argv[1]), *sys.argv[2:4])
    print(model, thinking)
