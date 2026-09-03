#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'pi startup sample: %s\n' "$1" >&2
  exit 1
}

scenario="${1:-}"
case "$scenario" in
  pty-control|full|no-extensions|minimal-resources) ;;
  *) fail "unknown scenario: ${scenario:-<empty>}" ;;
esac

if [[ "${PI_BENCHMARK_IN_PTY:-0}" != 1 ]]; then
  script_path="$(command -v script)" || fail "required command not found: script"
  export PI_BENCHMARK_IN_PTY=1

  case "$(uname -s)" in
    Darwin)
      exec "$script_path" -q /dev/null bash "$0" "$scenario" >/dev/null
      ;;
    Linux)
      printf -v command '%q ' bash "$0" "$scenario"
      exec "$script_path" --quiet --return --command "$command" /dev/null >/dev/null
      ;;
    *) fail "unsupported platform: $(uname -s)" ;;
  esac
fi

required_environment=(
  PI_BENCHMARK_AGENT_DIR
  PI_BENCHMARK_CACHE_HOME
  PI_BENCHMARK_CONFIG_HOME
  PI_BENCHMARK_DATA_HOME
  PI_BENCHMARK_HOME
  PI_BENCHMARK_PATH
  PI_BENCHMARK_PI
  PI_BENCHMARK_REPO_ROOT
  PI_BENCHMARK_STATE_HOME
  PI_BENCHMARK_TMPDIR
)
for name in "${required_environment[@]}"; do
  [[ -n "${!name:-}" ]] || fail "missing environment variable: $name"
done

stty rows 40 cols 120
[[ "$(stty size)" == "40 120" ]] || fail "failed to set PTY size to 40 rows by 120 columns"
cd "$PI_BENCHMARK_REPO_ROOT"

clean_environment=(
  "HOME=$PI_BENCHMARK_HOME"
  "LANG=C"
  "LC_ALL=C"
  "LOGNAME=pi-benchmark"
  "PATH=$PI_BENCHMARK_PATH"
  "SHELL=/bin/sh"
  "TERM=xterm-256color"
  "TZ=UTC"
  "USER=pi-benchmark"
  "XDG_CACHE_HOME=$PI_BENCHMARK_CACHE_HOME"
  "XDG_CONFIG_HOME=$PI_BENCHMARK_CONFIG_HOME"
  "XDG_DATA_HOME=$PI_BENCHMARK_DATA_HOME"
  "XDG_STATE_HOME=$PI_BENCHMARK_STATE_HOME"
  "TMPDIR=$PI_BENCHMARK_TMPDIR"
  "COLUMNS=120"
  "LINES=40"
  "PI_CODING_AGENT_DIR=$PI_BENCHMARK_AGENT_DIR"
  "PI_HARDWARE_CURSOR=0"
  "PI_HYPERLINKS=0"
  "PI_IMAGE_PROTOCOL=none"
  "PI_OFFLINE=1"
  "PI_SKIP_VERSION_CHECK=1"
  "PI_STARTUP_BENCHMARK=1"
  "PI_TELEMETRY=0"
  "PI_TRUE_COLOR=0"
)

if [[ "$scenario" == pty-control ]]; then
  exec env -i "${clean_environment[@]}" true
fi

pi_arguments=(--offline --no-session --approve)
case "$scenario" in
  full) ;;
  no-extensions)
    pi_arguments+=(--no-extensions)
    ;;
  minimal-resources)
    pi_arguments+=(
      --no-extensions
      --no-skills
      --no-prompt-templates
      --no-themes
      --no-context-files
    )
    ;;
esac

exec env -i "${clean_environment[@]}" "$PI_BENCHMARK_PI" "${pi_arguments[@]}"
