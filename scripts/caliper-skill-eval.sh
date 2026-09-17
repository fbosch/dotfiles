#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: caliper-skill-eval.sh [--ablate] [--auth-profile NAME] SKILL [MODEL] [THINKING] [K] [JUDGE_MODEL] [JUDGE_THINKING]
EOF
}

ablate=false
auth_profile=default
while (($# > 0)); do
  case "$1" in
  --ablate)
    ablate=true
    shift
    ;;
  --auth-profile)
    if (($# < 2)) || [[ "$2" == -* ]]; then
      printf '%s\n' '--auth-profile requires a profile name' >&2
      exit 2
    fi
    auth_profile="$2"
    shift 2
    ;;
  --)
    shift
    break
    ;;
  -*)
    usage >&2
    exit 2
    ;;
  *) break ;;
  esac
done

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
case "$auth_profile" in
default) ;;
*[!A-Za-z0-9._-]* | '' | . | ..)
  printf 'Invalid auth profile name: %s\n' "$auth_profile" >&2
  exit 2
  ;;
esac
case "$thinking" in off | minimal | low | medium | high | xhigh | max) ;; *)
  printf 'Unsupported thinking level: %s\n' "$thinking" >&2
  exit 2
  ;;
esac
case "$judge_thinking" in off | minimal | low | medium | high | xhigh | max) ;; *)
  printf 'Unsupported judge thinking level: %s\n' "$judge_thinking" >&2
  exit 2
  ;;
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
real_agent_dir="${PI_CODING_AGENT_DIR:-${HOME:?}/.pi/agent}"
if [[ "$auth_profile" == default ]]; then
  source_auth="$real_agent_dir/auth.json"
else
  source_auth="$real_agent_dir/auth-profiles/$auth_profile.json"
fi
if [[ ! -f "$source_auth" || -L "$source_auth" ]]; then
  printf 'Auth profile not found: %s\n' "$auth_profile" >&2
  exit 2
fi

run_root="$(mktemp -d "${TMPDIR:-/tmp}/caliper-skill-auth.XXXXXX")"
run_root="$(cd "$run_root" && pwd -P)"
run_home="$run_root/home"
canonical_agent="$run_home/.pi/agent"
canonical_auth="$canonical_agent/auth.json"
snapshot_auth="$run_root/original-auth.json"
mkdir -p "$canonical_agent"
chmod 700 "$run_home" "$canonical_agent"
cp -p "$source_auth" "$canonical_auth"
cp -p "$source_auth" "$snapshot_auth"
chmod 600 "$canonical_auth" "$snapshot_auth"
if [[ -f "$real_agent_dir/settings.json" && ! -L "$real_agent_dir/settings.json" ]]; then
  cp -p "$real_agent_dir/settings.json" "$canonical_agent/settings.json"
  chmod 600 "$canonical_agent/settings.json"
fi
trap 'rm -rf "$run_root"' EXIT

wrapper="$run_root/pi-wrapper"
cat >"$wrapper" <<'EOF'
#!/bin/sh
set -eu
umask 077
wrapper_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
run_root=__CALIPER_RUN_ROOT__
canonical_agent="$run_root/home/.pi/agent"
canonical_auth="$canonical_agent/auth.json"
isolated_agent="${PI_CODING_AGENT_DIR:-}"

sync_to_isolated() {
  if [ -n "$isolated_agent" ] && [ "$isolated_agent" != "$canonical_agent" ]; then
    mkdir -p "$isolated_agent"
    chmod 700 "$isolated_agent"
    tmp="$isolated_agent/auth.json.caliper.$$"
    cp "$canonical_auth" "$tmp"
    chmod 600 "$tmp"
    mv -f "$tmp" "$isolated_agent/auth.json"
  fi
}
sync_from_isolated() {
  if [ -n "$isolated_agent" ] && [ "$isolated_agent" != "$canonical_agent" ] \
    && [ -f "$isolated_agent/auth.json" ] && [ ! -L "$isolated_agent/auth.json" ]; then
    tmp="$canonical_agent/auth.json.caliper.$$"
    cp "$isolated_agent/auth.json" "$tmp"
    chmod 600 "$tmp"
    mv -f "$tmp" "$canonical_auth"
  fi
}

sync_to_isolated
pi_bin=__CALIPER_PI_BIN__
set +e
PI_OFFLINE=1 "$pi_bin" --no-extensions "$@"
child_status=$?
sync_from_isolated
sync_status=$?
set -e
if [ "$child_status" -ne 0 ]; then exit "$child_status"; fi
exit "$sync_status"
EOF
python3 - "$wrapper" "$run_root" "$pi_bin" <<'PY'
from pathlib import Path
import shlex
import sys
path, run_root, pi_bin = map(Path, sys.argv[1:])
text = path.read_text()
text = text.replace('__CALIPER_RUN_ROOT__', shlex.quote(str(run_root)))
text = text.replace('__CALIPER_PI_BIN__', shlex.quote(str(pi_bin)))
path.write_text(text)
PY
chmod 700 "$wrapper"

candidate="pi:openai-codex/$model:$thinking"
judge="pi:openai-codex/$judge_model:$judge_thinking"
args=(run "$spec" --k "$k" --workers 1 --model "$candidate" --judge-model "$judge")
if [[ "$ablate" == true ]]; then args+=(--ablate "$skill"); fi

set +e
env -u PI_CODING_AGENT_DIR HOME="$run_home" PI_CLI_PATH="$wrapper" caliper validate "$spec"
validate_status=$?
run_status=$validate_status
if ((validate_status == 0)); then
  env -u PI_CODING_AGENT_DIR HOME="$run_home" PI_CLI_PATH="$wrapper" caliper "${args[@]}"
  run_status=$?
fi
set -e

persist_status=0
if ((validate_status == 0)); then
  if [[ ! -f "$canonical_auth" ]]; then
    printf '%s\n' 'Caliper removed the run auth file; refusing to persist credentials.' >&2
    persist_status=1
  elif ! cmp -s "$source_auth" "$snapshot_auth"; then
    printf 'Auth profile changed during evaluation; refusing to overwrite: %s\n' "$auth_profile" >&2
    persist_status=1
  elif ! cmp -s "$canonical_auth" "$snapshot_auth"; then
    persist_tmp="$source_auth.caliper.$$"
    if cp "$canonical_auth" "$persist_tmp" && chmod 600 "$persist_tmp"; then
      if cmp -s "$source_auth" "$snapshot_auth"; then
        mv -f "$persist_tmp" "$source_auth" || persist_status=1
      else
        rm -f "$persist_tmp"
        printf 'Auth profile changed during evaluation; refusing to overwrite: %s\n' "$auth_profile" >&2
        persist_status=1
      fi
    else
      rm -f "$persist_tmp"
      persist_status=1
    fi
  fi
fi
if ((run_status != 0)); then exit "$run_status"; fi
exit "$persist_status"
