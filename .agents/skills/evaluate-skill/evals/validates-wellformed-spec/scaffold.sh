#!/usr/bin/env bash
set -euo pipefail

cat > valid.eval.yaml << 'SPEC'
skills:
  - ./SKILL.md
tasks:
  - name: Test arithmetic
    prompt: What is 2 + 2?
    expect: The assistant answers 4.
SPEC
