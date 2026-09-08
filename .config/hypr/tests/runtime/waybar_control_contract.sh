#!/usr/bin/env bash
set -euo pipefail

repo_root="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
hypr_dir="$repo_root/.config/hypr"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

home_dir="$test_dir/home"
bin_dir="$test_dir/bin"
runtime_dir="$test_dir/run"
mkdir -p "$home_dir/.config" "$bin_dir" "$runtime_dir"
ln -s "$hypr_dir" "$home_dir/.config/hypr"

cat > "$bin_dir/timeout" <<'EOF'
#!/usr/bin/env sh
printf '%s\n' "$*" >> "$WAYBAR_TIMEOUT_ARGS"
printf '%s\n' "$*" | grep -Fq -- 'nc -w 1 -U ' || exit 64
cat >> "$WAYBAR_REQUESTS"
printf '%b' "${WAYBAR_RESPONSE-ok\\n}"
exit "${WAYBAR_TRANSPORT_STATUS:-0}"
EOF
chmod +x "$bin_dir/timeout"

export WAYBAR_TIMEOUT_ARGS="$test_dir/timeout-args"
export WAYBAR_REQUESTS="$test_dir/requests"
run_control() {
  HOME="$home_dir" PATH="$bin_dir:$PATH" XDG_RUNTIME_DIR="$runtime_dir" \
    HYPRLAND_INSTANCE_SIGNATURE="fixture-instance" \
    "$hypr_dir/runtime/desktop/waybar-control.sh" "$@"
}

for intent in show hide prewarm hold release; do
  output="$(run_control "$intent")"
  [[ -z "$output" ]]
done
mapfile -t requests < "$WAYBAR_REQUESTS"
[[ "${requests[*]}" == 'show hide prewarm hold release' ]]
[[ "$(wc -l < "$WAYBAR_TIMEOUT_ARGS")" -eq 5 ]]
grep -Fxq -- "--foreground 1s nc -w 1 -U $runtime_dir/hypr/fixture-instance/waybar-monitor.sock" "$WAYBAR_TIMEOUT_ARGS"

for arguments in '' 'show extra' unknown layer-opened ping 'pointer-zone show'; do
  read -r -a argv <<< "$arguments"
  set +e
  invalid_output="$(run_control "${argv[@]}" 2>&1)"
  invalid_status=$?
  set -e
  [[ "$invalid_status" -eq 2 && "$invalid_output" == *'usage:'* ]]
done
[[ "$(wc -l < "$WAYBAR_TIMEOUT_ARGS")" -eq 5 ]]

set +e
identity_output="$(HOME="$home_dir" PATH="$bin_dir:$PATH" XDG_RUNTIME_DIR="$runtime_dir" \
  HYPRLAND_INSTANCE_SIGNATURE='' "$hypr_dir/runtime/desktop/waybar-control.sh" show 2>&1)"
identity_status=$?
set -e
[[ "$identity_status" -eq 1 && "$identity_output" == 'waybar-control: unavailable' ]]
[[ "$(wc -l < "$WAYBAR_TIMEOUT_ARGS")" -eq 5 ]]

for unavailable_home in unset "$test_dir/missing-home"; do
  set +e
  if [[ "$unavailable_home" == unset ]]; then
    unavailable_output="$(env -u HOME PATH="$bin_dir:$PATH" XDG_RUNTIME_DIR="$runtime_dir" \
      HYPRLAND_INSTANCE_SIGNATURE=fixture-instance \
      "$hypr_dir/runtime/desktop/waybar-control.sh" show 2>&1)"
  else
    unavailable_output="$(HOME="$unavailable_home" PATH="$bin_dir:$PATH" XDG_RUNTIME_DIR="$runtime_dir" \
      HYPRLAND_INSTANCE_SIGNATURE=fixture-instance \
      "$hypr_dir/runtime/desktop/waybar-control.sh" show 2>&1)"
  fi
  unavailable_status=$?
  set -e
  [[ "$unavailable_status" -eq 1 && "$unavailable_output" == 'waybar-control: unavailable' ]]
done
[[ "$(wc -l < "$WAYBAR_TIMEOUT_ARGS")" -eq 5 ]]

for response in '' 'no' 'ok\nextra\n' 'ok\n\n'; do
  set +e
  failure_output="$(WAYBAR_RESPONSE="$response" run_control show 2>&1)"
  failure_status=$?
  set -e
  [[ "$failure_status" -eq 1 && "$failure_output" == 'waybar-control: rejected' ]]
done

set +e
transport_output="$(WAYBAR_RESPONSE='ok\n' WAYBAR_TRANSPORT_STATUS=1 run_control show 2>&1)"
transport_status=$?
set -e
[[ "$transport_status" -eq 1 && "$transport_output" == 'waybar-control: unavailable' ]]

run_monitor() {
  HOME="$home_dir" PATH="$bin_dir:$PATH" XDG_RUNTIME_DIR="$runtime_dir" \
    HYPRLAND_INSTANCE_SIGNATURE="fixture-instance" \
    "$hypr_dir/runtime/desktop/waybar-monitor.sh" "$@"
}
run_monitor layer-opened
[[ "$(tail -n 1 "$WAYBAR_REQUESTS")" == 'layer-opened' ]]
for intent in show hide prewarm hold release; do
  set +e
  private_output="$(run_monitor "$intent" 2>&1)"
  private_status=$?
  set -e
  [[ "$private_status" -eq 2 && "$private_output" == *'public control intent'* ]]
done

printf 'PASS Waybar control accepts only public intents and forwards each request once\n'
