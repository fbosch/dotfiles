#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'bun benchmark: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_positive_integer() {
  [[ "$2" =~ ^[1-9][0-9]*$ ]] || fail "$1 must be a positive integer"
}

usage() {
  cat <<'EOF'
Usage: benchmark-bun.sh [runtime|install|profiles|all]

Environment:
  BUN_BENCHMARK_STARTUP_RUNS    Bun startup measurements (default: 30)
  BUN_BENCHMARK_STARTUP_WARMUPS Bun startup warmups (default: 10)
  BUN_BENCHMARK_RUNS            Hyperfine measurements per workload (default: 10)
  BUN_BENCHMARK_WARMUPS         Hyperfine warmups per workload (default: 3)
  BUN_BENCHMARK_INTERNAL_RUNS   Repetitions of self-measuring benchmarks (default: 3)
  BUN_BENCHMARK_OUTPUT_DIR      Exact result directory (default: XDG state directory)
EOF
}

[[ $# -le 1 ]] || fail "expected at most one target"
target="${1:-runtime}"
case "$target" in
  runtime|install|profiles|all) ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    fail "unknown target: $target"
    ;;
esac

require_command bun
require_command git
require_command hyperfine
require_command jq

runs="${BUN_BENCHMARK_RUNS:-10}"
warmups="${BUN_BENCHMARK_WARMUPS:-3}"
startup_runs="${BUN_BENCHMARK_STARTUP_RUNS:-30}"
startup_warmups="${BUN_BENCHMARK_STARTUP_WARMUPS:-10}"
internal_runs="${BUN_BENCHMARK_INTERNAL_RUNS:-3}"
require_positive_integer BUN_BENCHMARK_RUNS "$runs"
require_positive_integer BUN_BENCHMARK_WARMUPS "$warmups"
require_positive_integer BUN_BENCHMARK_STARTUP_RUNS "$startup_runs"
require_positive_integer BUN_BENCHMARK_STARTUP_WARMUPS "$startup_warmups"
require_positive_integer BUN_BENCHMARK_INTERNAL_RUNS "$internal_runs"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

bun_version="$(bun --version)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
state_root="${XDG_STATE_HOME:-$HOME/.local/state}/dotfiles/bun-benchmarks"
output_dir="${BUN_BENCHMARK_OUTPUT_DIR:-$state_root/$timestamp-bun-$bun_version}"
[[ ! -e "$output_dir" ]] || fail "output directory already exists: $output_dir"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd -P)"

untracked_workloads="$(git ls-files --others --exclude-standard -- \
  .config/fbb \
  .config/ags \
  .config/opencode/mcp/neovim \
  .config/opencode/plugins/prompt-enhancements)"
if [[ -n "$untracked_workloads" ]]; then
  printf 'bun benchmark: untracked benchmark workload files found:\n%s\n' "$untracked_workloads" >&2
  exit 1
fi
git diff --binary HEAD -- . >"$output_dir/worktree.patch"
cp scripts/benchmark-bun.sh "$output_dir/benchmark-bun.sh"

cpu_model="unknown"
if command -v lscpu >/dev/null 2>&1; then
  cpu_model="$(lscpu --json | jq -r '.lscpu[] | select(.field == "Model name:") | .data')"
elif command -v sysctl >/dev/null 2>&1; then
  cpu_model="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || printf unknown)"
fi

cpu_governor="unknown"
if [[ -r /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]]; then
  read -r cpu_governor </sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
fi

git_dirty=false
[[ -z "$(git status --porcelain)" ]] || git_dirty=true
jq -n \
  --arg timestamp "$timestamp" \
  --arg target "$target" \
  --arg bunVersion "$bun_version" \
  --arg bunPath "$(command -v bun)" \
  --arg hyperfineVersion "$(hyperfine --version)" \
  --arg hostname "$(hostname)" \
  --arg operatingSystem "$(uname -s)" \
  --arg architecture "$(uname -m)" \
  --arg kernel "$(uname -r)" \
  --arg cpuModel "$cpu_model" \
  --arg cpuGovernor "$cpu_governor" \
  --arg gitCommit "$(git rev-parse HEAD)" \
  --argjson gitDirty "$git_dirty" \
  --arg fbbPackageManager "$(jq -r .packageManager .config/fbb/package.json)" \
  --arg fishPackageManager "$(jq -r .packageManager .config/fish/libexec/package.json)" \
  --argjson runs "$runs" \
  --argjson warmups "$warmups" \
  --argjson startupRuns "$startup_runs" \
  --argjson startupWarmups "$startup_warmups" \
  --argjson internalRuns "$internal_runs" \
  '{
    timestamp: $timestamp,
    target: $target,
    bun: { version: $bunVersion, path: $bunPath },
    hyperfineVersion: $hyperfineVersion,
    system: {
      hostname: $hostname,
      operatingSystem: $operatingSystem,
      architecture: $architecture,
      kernel: $kernel,
      cpuModel: $cpuModel,
      cpuGovernor: $cpuGovernor
    },
    git: { commit: $gitCommit, dirty: $gitDirty },
    packageManagers: { fbb: $fbbPackageManager, fishLibexec: $fishPackageManager },
    repetitions: {
      hyperfine: $runs,
      warmups: $warmups,
      startup: $startupRuns,
      startupWarmups: $startupWarmups,
      internal: $internalRuns
    },
    source: { patch: "worktree.patch", benchmarkScript: "benchmark-bun.sh" }
  }' >"$output_dir/metadata.json"

run_runtime_benchmarks() {
  hyperfine \
    --shell=none \
    --style basic \
    --warmup "$startup_warmups" \
    --runs "$startup_runs" \
    --export-json "$output_dir/startup.json" \
    --export-markdown "$output_dir/startup.md" \
    --command-name bun-startup 'bun -e "void 0"'

  hyperfine \
    --shell=none \
    --style basic \
    --sort command \
    --warmup "$warmups" \
    --runs "$runs" \
    --export-json "$output_dir/runtime.json" \
    --export-markdown "$output_dir/runtime.md" \
    --command-name fbb-tests 'bun test --cwd .config/fbb ./lib' \
    --command-name ags-tests 'bun test --cwd .config/ags' \
    --command-name neovim-mcp-tests 'bun test --cwd .config/opencode/mcp/neovim'

  for ((iteration = 1; iteration <= internal_runs; iteration += 1)); do
    bun run --cwd .config/opencode/plugins bench:typos \
      >"$output_dir/typo-engine-$iteration.txt"
    AI_POINTER_BENCH_SAMPLES=5 AI_POINTER_POLICY_BATCH=100 \
      bun run --cwd .config/ags components/ai-pointer/__benchmarks__/policy.ts \
      >"$output_dir/ai-pointer-policy-$iteration.json"
    bun run --cwd .config/opencode/mcp/neovim benchmark \
      >"$output_dir/neovim-mcp-$iteration.txt" 2>&1
  done
}

run_install_benchmarks() (
  local install_root
  install_root="$(mktemp -d)"
  trap 'rm -rf -- "$install_root"' EXIT

  mkdir -p "$install_root/fbb" "$install_root/fish-libexec"
  cp .config/fbb/package.json .config/fbb/bun.lock "$install_root/fbb/"
  cp .config/fish/libexec/package.json .config/fish/libexec/bun.lock .config/fish/libexec/bunfig.toml \
    "$install_root/fish-libexec/"

  bun install --frozen-lockfile --ignore-scripts --cwd "$install_root/fbb" >/dev/null
  bun install --frozen-lockfile --ignore-scripts --cwd "$install_root/fish-libexec" >/dev/null

  cd "$install_root"
  hyperfine \
    --shell=none \
    --style basic \
    --sort command \
    --warmup "$warmups" \
    --runs "$runs" \
    --prepare 'rm -rf fbb/node_modules fish-libexec/node_modules' \
    --export-json "$output_dir/install.json" \
    --export-markdown "$output_dir/install.md" \
    --command-name fbb-warm-install 'bun install --frozen-lockfile --ignore-scripts --cwd fbb' \
    --command-name fish-libexec-warm-install 'bun install --frozen-lockfile --ignore-scripts --cwd fish-libexec'
)

run_profiles() {
  local profile_dir="$output_dir/profiles"
  mkdir -p "$profile_dir"

  AI_POINTER_BENCH_SAMPLES=5 AI_POINTER_POLICY_BATCH=100 bun \
    --cpu-prof-md \
    --cpu-prof-dir "$profile_dir" \
    --cpu-prof-name ai-pointer-policy-cpu.md \
    --cwd .config/ags \
    components/ai-pointer/__benchmarks__/policy.ts \
    >"$profile_dir/ai-pointer-policy-cpu.txt" 2>&1
  bun \
    --cpu-prof-md \
    --cpu-prof-dir "$profile_dir" \
    --cpu-prof-name typo-engine-cpu.md \
    --cwd .config/opencode/plugins \
    prompt-enhancements/typo-engine.bench.ts \
    >"$profile_dir/typo-engine-cpu.txt" 2>&1
  AI_POINTER_BENCH_SAMPLES=5 AI_POINTER_POLICY_BATCH=100 bun \
    --heap-prof-md \
    --heap-prof-dir "$profile_dir" \
    --heap-prof-name ai-pointer-policy-heap.md \
    --cwd .config/ags \
    components/ai-pointer/__benchmarks__/policy.ts \
    >"$profile_dir/ai-pointer-policy-heap.txt" 2>&1
}

printf 'Bun %s benchmark results: %s\n' "$bun_version" "$output_dir"

case "$target" in
  runtime)
    run_runtime_benchmarks
    ;;
  install)
    run_install_benchmarks
    ;;
  profiles)
    run_profiles
    ;;
  all)
    run_runtime_benchmarks
    run_install_benchmarks
    ;;
esac

printf 'Benchmark complete: %s\n' "$output_dir"
