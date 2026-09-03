#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'pi startup benchmark: %s\n' "$1" >&2
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
Usage: startup.sh [full|breakdown]

Targets:
  full       Measure the complete Pi setup only.
  breakdown  Measure the complete setup and resource-disabled controls (default).

Environment:
  PI_BENCHMARK_RUNS       Measurements per scenario (default: 20)
  PI_BENCHMARK_WARMUPS    Warm-cache runs per scenario (default: 5)
  PI_BENCHMARK_OUTPUT_DIR Exact result directory (default: XDG state directory)
  PI_BENCHMARK_PI         Pi executable to measure (default: pi from PATH)
EOF
}

target="${1:-breakdown}"
case "$target" in
  full|breakdown) ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    fail "unknown target: $target"
    ;;
esac

require_command git
require_command hyperfine
require_command jq
require_command script

timeout_bin=""
for candidate in timeout gtimeout; do
  candidate_path="$(command -v "$candidate" || true)"
  if [[ -n "$candidate_path" ]]; then
    timeout_bin="$candidate_path"
    break
  fi
done
[[ -n "$timeout_bin" ]] || fail "required command not found: timeout or gtimeout"

runs="${PI_BENCHMARK_RUNS:-20}"
warmups="${PI_BENCHMARK_WARMUPS:-5}"
sample_timeout="${PI_BENCHMARK_TIMEOUT:-30s}"
require_positive_integer PI_BENCHMARK_RUNS "$runs"
require_positive_integer PI_BENCHMARK_WARMUPS "$warmups"
[[ "$sample_timeout" =~ ^[1-9][0-9]*(s|m|h|d)?$ ]] \
  || fail "PI_BENCHMARK_TIMEOUT must be a positive timeout duration (for example, 30s)"

benchmark_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
agent_dir="$(cd "$benchmark_dir/.." && pwd -P)"
repo_root="$(git -C "$agent_dir" rev-parse --show-toplevel)"
sample_script="$benchmark_dir/startup-sample.sh"
shutdown_extension="$benchmark_dir/startup-shutdown.ts"
[[ -f "$shutdown_extension" ]] || fail "benchmark shutdown extension not found: $shutdown_extension"
host_path=""
IFS=: read -r -a path_entries <<<"$PATH"
for path_entry in "${path_entries[@]}"; do
  [[ "$path_entry" == "$agent_dir/node_modules/.bin" ]] && continue
  host_path="${host_path:+$host_path:}$path_entry"
done
if [[ -n "${PI_BENCHMARK_PI:-}" ]]; then
  pi_bin="$PI_BENCHMARK_PI"
else
  pi_bin="$(PATH="$host_path" command -v pi || true)"
fi
[[ -n "$pi_bin" && -x "$pi_bin" ]] || fail "Pi executable not found"

benchmark_path=""
append_path() {
  local directory="$1"
  [[ -d "$directory" ]] || return 0
  case ":$benchmark_path:" in
    *":$directory:"*) return ;;
  esac
  benchmark_path="${benchmark_path:+$benchmark_path:}$directory"
}
append_path "$(dirname "$pi_bin")"
for command in bash bun direnv fd git gh node podman rg; do
  command_path="$(PATH="$host_path" command -v "$command" || true)"
  [[ -n "$command_path" ]] && append_path "$(dirname "$command_path")"
done
for directory in /usr/local/bin /opt/homebrew/bin /opt/homebrew/sbin /usr/bin /bin /usr/sbin /sbin; do
  append_path "$directory"
done
pi_version="$("$pi_bin" --version)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
state_root="${XDG_STATE_HOME:-$HOME/.local/state}/dotfiles/pi-benchmarks"
output_dir="${PI_BENCHMARK_OUTPUT_DIR:-$state_root/$timestamp-pi-$pi_version}"
[[ ! -e "$output_dir" ]] || fail "output directory already exists: $output_dir"

umask 077
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd -P)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/pi-startup-benchmark.XXXXXX")"
fixture_root="$(cd "$fixture_root" && pwd -P)"
initial_worktree_status="$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all)"
cleanup() {
  local attempt
  # A timed-out Pi process may still be unwinding Jiti files while its process group exits.
  for ((attempt = 1; attempt <= 20; attempt += 1)); do
    if rm -rf -- "$fixture_root" 2>/dev/null; then
      return
    fi
    sleep 0.1
  done
  printf 'pi startup benchmark: failed to remove fixture: %s\n' "$fixture_root" >&2
  return 1
}
trap cleanup EXIT

fixture_agent="$fixture_root/agent"
fixture_home="$fixture_root/home"
fixture_cache="$fixture_root/cache"
fixture_data="$fixture_root/data"
fixture_state="$fixture_root/state"
fixture_tmp="$fixture_root/tmp"
manifest_dir="$fixture_root/manifests"
mkdir -p \
  "$fixture_agent" \
  "$fixture_home" \
  "$fixture_cache" \
  "$fixture_data" \
  "$fixture_state" \
  "$fixture_tmp" \
  "$manifest_dir"

# Mutable Pi files are copied into the temporary fixture. Credentials and sessions are
# excluded. Offline mode disables package updates, so installed dependencies can be linked.
for source in "$agent_dir"/* "$agent_dir"/.[!.]* "$agent_dir"/..?*; do
  [[ -e "$source" || -L "$source" ]] || continue
  name="${source##*/}"
  case "$name" in
    .fallow|auth*.json|auth-profiles|benchmarks|fff|mcp-cache.json|mcp-onboarding.json|models-store.json|sessions|subagent-sessions|trust.json|tmp|*.log) continue ;;
    node_modules|npm|git|bin|tools)
      ln -s "$source" "$fixture_agent/$name"
      ;;
    *) cp -R "$source" "$fixture_agent/$name" ;;
  esac
done
find "$fixture_agent" -type d -name __tests__ -prune -exec rm -rf -- {} +
cp "$shutdown_extension" "$fixture_agent/startup-benchmark-shutdown.ts"

if [[ -d "$repo_root/.agents" ]]; then
  mkdir -p "$fixture_home/.agents"
  cp -R "$repo_root/.agents/." "$fixture_home/.agents"
fi
typo_rules="$repo_root/.config/fbb/data/typos.abolish"
if [[ -f "$typo_rules" ]]; then
  mkdir -p "$fixture_home/.config/fbb/data"
  cp "$typo_rules" "$fixture_home/.config/fbb/data/typos.abolish"
fi

project_settings="$repo_root/.pi/settings.json"
if [[ -f "$project_settings" ]]; then
  while IFS= read -r reference_path; do
    [[ "${reference_path:0:2}" == \~/ ]] || continue
    relative_path="${reference_path:2}"
    case "/$relative_path/" in
      *'/../'*|'//'*) fail "unsafe project reference path: $reference_path" ;;
    esac
    source_path="$HOME/$relative_path"
    [[ -d "$source_path" ]] || continue
    target_path="$fixture_home/$relative_path"
    mkdir -p "$(dirname "$target_path")"
    target_parent="$(cd "$(dirname "$target_path")" && pwd -P)"
    [[ "$target_parent" == "$fixture_home" || "$target_parent" == "$fixture_home/"* ]] \
      || fail "project reference escapes fixture home: $reference_path"
    [[ -e "$target_path" || -L "$target_path" ]] || ln -s "$source_path" "$target_path"
  done < <(jq -r '.references // {} | .[] | .path // empty' "$project_settings")
fi

write_external_source_manifest() {
  local output_path="$1"

  git -C "$repo_root" ls-files -co --exclude-standard -z -- \
    .pi/settings.json \
    .agents \
    .config/fbb/data/typos.abolish \
    AGENTS.md \
    docs-lock.json \
    | LC_ALL=C sort -z \
    | while IFS= read -r -d '' path; do
        printf '%s\t%s\n' "$path" "$(git -C "$repo_root" hash-object "$path")"
      done >"$output_path"
}

assemble_manifest() {
  local root="$1"
  local file_list="$2"
  local link_list="$3"
  local output_path="$4"
  local hash_list="$manifest_dir/content-hashes.txt"

  awk -v root="$root" '{ print root "/" $0 }' "$file_list" \
    | git hash-object --stdin-paths >"$hash_list"
  {
    paste "$file_list" "$hash_list" | awk -F '\t' '{ print $1 "\tfile:" $2 }'
    (
      cd "$root"
      while IFS= read -r path; do
        printf '%s\tlink:%s\n' "$path" "$(readlink "$path")"
      done <"$link_list"
    )
  } | LC_ALL=C sort >"$output_path"
}

write_dependency_manifest() {
  local output_path="$1"
  local file_list="$manifest_dir/dependency-files.txt"
  local link_list="$manifest_dir/dependency-links.txt"
  local dependency_roots=()
  local name

  for name in node_modules npm git bin tools; do
    [[ -e "$agent_dir/$name" || -L "$agent_dir/$name" ]] && dependency_roots+=("$name")
  done
  (
    cd "$agent_dir"
    find "${dependency_roots[@]}" -type f -print | LC_ALL=C sort >"$file_list"
    find "${dependency_roots[@]}" -type l -print | LC_ALL=C sort >"$link_list"
  )
  assemble_manifest "$agent_dir" "$file_list" "$link_list" "$output_path"
}

write_fixture_manifest() {
  local output_path="$1"
  local file_list="$manifest_dir/fixture-files.txt"
  local link_list="$manifest_dir/fixture-links.txt"

  (
    cd "$fixture_root"
    # LMDB rewrites its process-lock bookkeeping even when the indexed data is unchanged.
    find agent home cache data state tmp \
      -type f \
      ! -path 'agent/fff/*/lock.mdb' \
      ! -path 'agent/sessions/permission-forwarding/serving/*.json' \
      -print | LC_ALL=C sort >"$file_list"
    find agent home cache data state tmp -type l -print | LC_ALL=C sort >"$link_list"
  )
  assemble_manifest "$fixture_root" "$file_list" "$link_list" "$output_path"
}

export PI_BENCHMARK_AGENT_DIR="$fixture_agent"
export PI_BENCHMARK_CACHE_HOME="$fixture_cache"
export PI_BENCHMARK_CONFIG_HOME="$fixture_home/.config"
export PI_BENCHMARK_DATA_HOME="$fixture_data"
export PI_BENCHMARK_HOME="$fixture_home"
export PI_BENCHMARK_PATH="$benchmark_path"
export PI_BENCHMARK_PI="$pi_bin"
export PI_BENCHMARK_REPO_ROOT="$repo_root"
export PI_BENCHMARK_STATE_HOME="$fixture_state"
export PI_BENCHMARK_TMPDIR="$fixture_tmp"
export PI_BENCHMARK_SHUTDOWN_EXTENSION="$fixture_agent/startup-benchmark-shutdown.ts"

run_sample() {
  local scenario="$1"
  "$timeout_bin" --kill-after=2s "$sample_timeout" bash "$sample_script" "$scenario"
}

printf 'Pi %s startup benchmark: %s\n' "$pi_version" "$output_dir"
printf 'Per-sample timeout: %s\n' "$sample_timeout"
printf 'Preparing isolated warm-cache fixture...\n'
external_source_manifest_before="$manifest_dir/external-source-before.tsv"
external_source_manifest_after="$manifest_dir/external-source-after.tsv"
dependency_manifest_before="$manifest_dir/dependencies-before.tsv"
dependency_manifest_after="$manifest_dir/dependencies-after.tsv"
fixture_source_manifest="$manifest_dir/fixture-source.tsv"
fixture_manifest_before="$manifest_dir/fixture-before.tsv"
fixture_manifest_after="$manifest_dir/fixture-after.tsv"
write_external_source_manifest "$external_source_manifest_before"
write_fixture_manifest "$fixture_source_manifest"
external_source_fingerprint="$(git hash-object "$external_source_manifest_before")"
fixture_source_fingerprint="$(git hash-object "$fixture_source_manifest")"
if ! run_sample full; then
  fail "preflight startup failed or exceeded $sample_timeout"
fi

warmup_scenarios=(pty-control full)
if [[ "$target" == breakdown ]]; then
  warmup_scenarios+=(no-extensions minimal-resources)
fi
for scenario in "${warmup_scenarios[@]}"; do
  for ((iteration = 1; iteration <= warmups; iteration += 1)); do
    if ! run_sample "$scenario"; then
      fail "warmup '$scenario' failed or exceeded $sample_timeout"
    fi
  done
done

printf 'Fingerprinting linked dependencies before measurement...\n'
write_dependency_manifest "$dependency_manifest_before"
write_fixture_manifest "$fixture_manifest_before"
dependency_fingerprint="$(git hash-object "$dependency_manifest_before")"
setup_fingerprint="$(
  printf '%s\n%s\n%s\n' \
    "$fixture_source_fingerprint" \
    "$external_source_fingerprint" \
    "$dependency_fingerprint" \
    | git hash-object --stdin
)"

cpu_model="unknown"
if command -v lscpu >/dev/null 2>&1; then
  cpu_model="$(lscpu --json | jq -r '.lscpu[] | select(.field == "Model name:") | .data')"
elif command -v sysctl >/dev/null 2>&1; then
  cpu_model="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || printf unknown)"
fi

git_dirty=false
[[ -z "$initial_worktree_status" ]] || git_dirty=true
local_extension_module_count="$(find "$fixture_agent/extensions" -type f \( -name '*.ts' -o -name '*.js' \) ! -path '*/__tests__/*' | wc -l | tr -d ' ')"
package_count="$(jq '.packages // [] | length' "$fixture_agent/settings.json")"

jq -n \
  --arg timestamp "$timestamp" \
  --arg target "$target" \
  --arg piVersion "$pi_version" \
  --arg piPath "$pi_bin" \
  --arg bunVersion "$(bun --version 2>/dev/null || printf unavailable)" \
  --arg hyperfineVersion "$(hyperfine --version)" \
  --arg scriptPath "$(command -v script)" \
  --arg operatingSystem "$(uname -s)" \
  --arg architecture "$(uname -m)" \
  --arg kernel "$(uname -r)" \
  --arg cpuModel "$cpu_model" \
  --arg benchmarkPath "$benchmark_path" \
  --arg gitCommit "$(git -C "$repo_root" rev-parse HEAD)" \
  --argjson gitDirty "$git_dirty" \
  --arg setupFingerprint "$setup_fingerprint" \
  --arg fixtureSourceFingerprint "$fixture_source_fingerprint" \
  --arg externalSourceFingerprint "$external_source_fingerprint" \
  --arg dependencyFingerprint "$dependency_fingerprint" \
  --argjson runs "$runs" \
  --argjson warmups "$warmups" \
  --arg sampleTimeout "$sample_timeout" \
  --argjson localExtensionModuleCount "$local_extension_module_count" \
  --argjson packageCount "$package_count" \
  '{
    schemaVersion: 1,
    timestamp: $timestamp,
    target: $target,
    workload: "warm-cache interactive startup",
    primaryMetric: "full median wall time",
    pi: { version: $piVersion, path: $piPath },
    bunVersion: $bunVersion,
    hyperfineVersion: $hyperfineVersion,
    system: {
      operatingSystem: $operatingSystem,
      architecture: $architecture,
      kernel: $kernel,
      cpuModel: $cpuModel,
      scriptPath: $scriptPath
    },
    git: { commit: $gitCommit, dirty: $gitDirty },
    inputs: {
      setupFingerprint: $setupFingerprint,
      fixtureSourceFingerprint: $fixtureSourceFingerprint,
      externalSourceFingerprint: $externalSourceFingerprint,
      dependencyFingerprint: $dependencyFingerprint
    },
    setup: {
      localExtensionModuleCount: $localExtensionModuleCount,
      packageCount: $packageCount
    },
    repetitions: { runs: $runs, warmups: $warmups, sampleTimeout: $sampleTimeout },
    piStartupBenchmarkDrainMs: 150,
    isolation: {
      offline: "Pi-managed startup network operations disabled",
      credentials: "excluded",
      liveRuntimeCaches: "excluded, then warmed inside fixture",
      ephemeralSession: true,
      mutableStateRoots: "temporary fixture",
      installedDependencies: "symlinked, content fingerprinted, package updates disabled",
      shutdown: "benchmark extension requests graceful shutdown after Pi stops the TUI",
      environment: {
        inherited: "allowlist",
        path: $benchmarkPath,
        shell: "/bin/sh",
        user: "pi-benchmark",
        locale: "C",
        timezone: "UTC"
      },
      terminal: {
        term: "xterm-256color",
        rows: 40,
        columns: 120,
        hyperlinks: false,
        images: false,
        trueColor: false,
        hardwareCursor: false
      }
    },
    scenarios: {
      "pty-control": ["true"],
      full: ["--offline", "--no-session", "--approve", "--extension", "<benchmark-shutdown>"],
      "no-extensions": [
        "--offline", "--no-session", "--approve", "--no-extensions",
        "--extension", "<benchmark-shutdown>"
      ],
      "minimal-resources": [
        "--offline", "--no-session", "--approve", "--no-extensions", "--extension",
        "<benchmark-shutdown>", "--no-skills",
        "--no-prompt-templates", "--no-themes", "--no-context-files"
      ]
    }
  }' >"$output_dir/metadata.json"

printf -v pty_control_command '%q --kill-after=2s %q bash %q %q' \
  "$timeout_bin" "$sample_timeout" "$sample_script" pty-control
printf -v full_command '%q --kill-after=2s %q bash %q %q' \
  "$timeout_bin" "$sample_timeout" "$sample_script" full
printf -v no_extensions_command '%q --kill-after=2s %q bash %q %q' \
  "$timeout_bin" "$sample_timeout" "$sample_script" no-extensions
printf -v minimal_resources_command '%q --kill-after=2s %q bash %q %q' \
  "$timeout_bin" "$sample_timeout" "$sample_script" minimal-resources

if ! hyperfine \
  --shell=bash \
  --style basic \
  --runs "$runs" \
  --export-json "$output_dir/pty-control.json" \
  --export-markdown "$output_dir/pty-control.md" \
  --command-name pty-control "$pty_control_command"; then
  fail "pty-control benchmark failed or exceeded $sample_timeout"
fi

startup_commands=(
  --shell=bash
  --style basic
  --runs "$runs"
  --export-json "$output_dir/startup.json"
  --export-markdown "$output_dir/startup.md"
  --command-name full "$full_command"
)
if [[ "$target" == breakdown ]]; then
  startup_commands+=(
    --command-name no-extensions "$no_extensions_command"
    --command-name minimal-resources "$minimal_resources_command"
  )
fi
if ! hyperfine "${startup_commands[@]}"; then
  fail "startup benchmark failed or exceeded $sample_timeout"
fi

printf 'Validating fixture fingerprints after measurement...\n'
write_fixture_manifest "$fixture_manifest_after"
printf 'Validating linked dependency fingerprint after measurement...\n'
write_dependency_manifest "$dependency_manifest_after"
write_external_source_manifest "$external_source_manifest_after"
if ! cmp -s "$fixture_manifest_before" "$fixture_manifest_after"; then
  printf 'pi startup benchmark: isolated Pi state changed during measured runs:\n' >&2
  comm -3 "$fixture_manifest_before" "$fixture_manifest_after" \
    | sed $'s/^\t//' \
    | cut -f 1 \
    | uniq \
    | sed 's/^/  /' >&2
  fail "fixture mutation invalidated the benchmark"
fi
if ! cmp -s "$external_source_manifest_before" "$external_source_manifest_after"; then
  printf 'pi startup benchmark: project startup source changed during measured runs:\n' >&2
  comm -3 "$external_source_manifest_before" "$external_source_manifest_after" \
    | sed $'s/^\t//' \
    | cut -f 1 \
    | uniq \
    | sed 's/^/  /' >&2
  fail "project source mutation invalidated the benchmark"
fi
if ! cmp -s "$dependency_manifest_before" "$dependency_manifest_after"; then
  printf 'pi startup benchmark: linked dependency content changed during measured runs:\n' >&2
  comm -3 "$dependency_manifest_before" "$dependency_manifest_after" \
    | sed $'s/^\t//' \
    | cut -f 1 \
    | uniq \
    | sed 's/^/  /' >&2
  fail "dependency mutation invalidated the benchmark"
fi
jq -n \
  --slurpfile control "$output_dir/pty-control.json" \
  --slurpfile startup "$output_dir/startup.json" \
  '
    def metric:
      {
        scenario: .command,
        samples: (.times | length),
        meanMs: (.mean * 1000),
        medianMs: (.median * 1000),
        stddevMs: ((.stddev // 0) * 1000),
        minMs: (.min * 1000),
        maxMs: (.max * 1000)
      };
    {
      schemaVersion: 1,
      primaryMetric: "full median wall time",
      ptyControl: ($control[0].results[0] | metric),
      scenarios: ($startup[0].results | map(metric))
    }
  ' >"$output_dir/summary.json"

printf '\nSummary (wall time):\n'
jq -r '
  ([.ptyControl] + .scenarios)[]
  | [.scenario, (.medianMs | tostring), (.meanMs | tostring), (.stddevMs | tostring)]
  | @tsv
' "$output_dir/summary.json" \
  | awk -F '\t' 'BEGIN { printf "%-20s %12s %12s %12s\n", "scenario", "median ms", "mean ms", "stddev ms" }
    { printf "%-20s %12.1f %12.1f %12.1f\n", $1, $2, $3, $4 }'
printf '\nBenchmark complete: %s\n' "$output_dir"
