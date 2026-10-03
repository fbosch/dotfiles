#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../../../" && pwd)"
test_dir="$(mktemp -d)"
bin_dir="$test_dir/bin"
home_dir="$test_dir/home"
notify_log="$test_dir/notifications.log"
screenshot="$repo_root/.config/hypr/runtime/capture/screenshot.sh"

cleanup() {
    rm -rf "$test_dir"
}
trap cleanup EXIT

mkdir -p "$bin_dir" "$home_dir/.config/hypr/runtime/desktop"

cat > "$home_dir/.config/hypr/runtime/desktop/nerd-icon-gen.sh" <<'SH'
#!/usr/bin/env bash
printf 'test-icon\n'
SH

cat > "$bin_dir/grimblast" <<'SH'
#!/usr/bin/env bash
if [[ "$1" != "copysave" ]]; then
    exit 1
fi
output="${@: -1}"
printf 'test-capture\n' > "$output"
SH

cat > "$bin_dir/notify-send" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$NOTIFY_LOG"
SH

chmod +x "$home_dir/.config/hypr/runtime/desktop/nerd-icon-gen.sh" "$bin_dir/grimblast" "$bin_dir/notify-send"

run_screenshot() {
    HOME="$home_dir" \
        NOTIFY_LOG="$notify_log" \
        PATH="$bin_dir:$PATH" \
        bash "$screenshot" screen "$@"
}

run_screenshot
for _ in {1..100}; do
    if grep -Fq 'Screenshot Captured' "$notify_log" 2>/dev/null; then
        break
    fi
    sleep 0.01
done
grep -Fq 'Screenshot Captured' "$notify_log"

: > "$notify_log"
run_screenshot --silent-success
sleep 0.05
if [[ -s "$notify_log" ]]; then
    printf 'Silent success mode unexpectedly showed a notification:\n' >&2
    cat "$notify_log" >&2
    exit 1
fi

printf 'Screenshot success notifications respect --silent-success.\n'
