#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: caliper-skill-eval.sh [--ablate] SKILL [MODEL] [THINKING] [K] [JUDGE_MODEL] [JUDGE_THINKING]
EOF
}

ablate=false
if [[ "${1:-}" == "--ablate" ]]; then
  ablate=true
  shift
fi

skill="${1:-}"
model="${2:-gpt-5.6-luna}"
thinking="${3:-medium}"
k="${4:-1}"
judge_model="${5:-gpt-5.6-sol}"
judge_thinking="${6:-high}"

if [[ -z "$skill" || $# -gt 6 ]]; then
  usage >&2
  exit 2
fi

case "$thinking" in
  off|minimal|low|medium|high|xhigh|max) ;;
  *) printf 'Unsupported thinking level: %s\n' "$thinking" >&2; exit 2 ;;
esac
case "$judge_thinking" in
  off|minimal|low|medium|high|xhigh|max) ;;
  *) printf 'Unsupported judge thinking level: %s\n' "$judge_thinking" >&2; exit 2 ;;
esac
if [[ ! "$k" =~ ^[1-9][0-9]*$ ]]; then
  printf 'K must be a positive integer: %s\n' "$k" >&2
  exit 2
fi
if [[ ! "$skill" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  printf 'Invalid skill name: %s\n' "$skill" >&2
  exit 2
fi

spec=".agents/skills/$skill/$skill.eval.yaml"
if [[ ! -f "$spec" ]]; then
  printf 'Eval spec not found: %s\n' "$spec" >&2
  exit 2
fi

pi_bin="$(command -v pi)"
wrapper="$(mktemp "${TMPDIR:-/tmp}/caliper-pi.XXXXXX")"
cleanup() {
  rm -f "$wrapper"
}
trap cleanup EXIT

cat >"$wrapper" <<EOF
#!/bin/sh
PI_OFFLINE=1 exec "$pi_bin" --no-extensions "\$@"
EOF
chmod +x "$wrapper"

candidate="pi:openai-codex/$model:$thinking"
judge="pi:openai-codex/$judge_model:$judge_thinking"
args=(run "$spec" --k "$k" --workers 1 --model "$candidate" --judge-model "$judge")
if [[ "$ablate" == true ]]; then
  args+=(--ablate "$skill")
fi

caliper validate "$spec"
PI_CLI_PATH="$wrapper" caliper "${args[@]}"
