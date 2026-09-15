---
description: Ported from evaluate-skill.eval.yaml task "Creates an engineless eval spec and defers the engine to run time"
tags: [spec-authoring]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill, Write]
---

Create an evaluation spec file at `created.eval.yaml` for a skill at `./SKILL.md` that I intend to run on the Codex CLI. Include one task named "Answers arithmetic", with prompt "What is 2 + 2?" and expectation "The assistant answers 4." Then tell me how to run it against Codex.
