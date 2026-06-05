#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
hypr_dir="$(cd -- "$script_dir/.." && pwd)"
profilectl="$hypr_dir/runtime/profiles/profilectl.sh"
iterations="${1:-100}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

bin_dir="$tmp_dir/bin"
runtime_dir="$tmp_dir/runtime"
mkdir -p "$bin_dir" "$runtime_dir"

cat > "$bin_dir/hyprctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$bin_dir/ags" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$bin_dir/pkill" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$bin_dir/powerprofilesctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$bin_dir/hyprctl" "$bin_dir/ags" "$bin_dir/pkill" "$bin_dir/powerprofilesctl"

run_profilectl() {
  PATH="$bin_dir:$PATH" XDG_RUNTIME_DIR="$runtime_dir" "$profilectl" "$@" >/dev/null 2>&1
}

bench() {
  local name="$1"
  shift
  local start end elapsed_ms per_call_us

  start="$(date +%s%N)"
  for _ in $(seq 1 "$iterations"); do
    run_profilectl "$@" || true
  done
  end="$(date +%s%N)"
  elapsed_ms=$(((end - start) / 1000000))
  per_call_us=$(((end - start) / iterations / 1000))

  printf '%-28s %8d iters %8d us/call %8d ms total\n' "$name" "$iterations" "$per_call_us" "$elapsed_ms"
}

run_profilectl sync powersave 0 || true
run_profilectl sync gaming 0 || true

bench "is-active inactive" is-active powersave

run_profilectl sync powersave 1 || true
bench "is-active active" is-active powersave

run_profilectl sync powersave 0 || true
bench "apply powersave" apply powersave

run_profilectl sync powersave 1 || true
bench "remove powersave" remove powersave

bench "sync gaming 0" sync gaming 0
bench "sync gaming 1" sync gaming 1
bench "status" status
bench "reconcile" reconcile
