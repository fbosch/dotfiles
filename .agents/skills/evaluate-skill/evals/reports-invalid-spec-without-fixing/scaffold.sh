#!/usr/bin/env bash
set -euo pipefail

cat > invalid.eval.yaml << 'SPEC'
skills:
  - ./SKILL.md
tasks:
  - name: Broken task
    prompt: do something
SPEC
