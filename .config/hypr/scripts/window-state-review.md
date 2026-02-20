# Code Review: window-state.sh

**File:** `.config/hypr/scripts/window-state.sh`  
**Date:** 2026-02-20  
**Reviewer:** Claude Code

---

## Critical

### 1. Insecure `/tmp` paths
**Lines:** 15, 350, 364

`STATE_FILE` and the debounce file use hardcoded world-writable `/tmp` paths, vulnerable to symlink attacks and unauthorized access. Use `$XDG_RUNTIME_DIR` (mode 700, user-owned):

```bash
STATE_FILE="${XDG_RUNTIME_DIR}/hypr-window-state.cache"
DEBOUNCE_FILE="${XDG_RUNTIME_DIR}/hypr-window-state-debounce"
```

### 2. `mktemp` failure not checked
**Function:** `update_rules`, line 353

If `mktemp` fails, `temp_file` is empty and `mv "$temp_file" "$RULES_FILE"` silently corrupts or deletes the rules file.

```bash
temp_file=$(mktemp) || { printf 'ERROR: Failed to create temp file\n' >&2; return 1; }
```

### 3. Stale state fallback in `immediate_save`
**Lines:** 394–401

When all windows close, the fallback reads `STATE_FILE` and saves it — but this state is already stale (the window was already closed). The intent is to capture the last position, but `check_and_save_with_state` already writes to `STATE_FILE` on every poll tick, so the fallback is redundant and misleading. Remove it.

### 4. Race condition: polling subprocess exits silently
**Lines:** 188–211

When the subprocess exits itself (no tracked windows), `POLL_PID` in the parent is never cleared. `start_polling` will then see a dead PID and refuse to restart. Add a `wait` in `stop_polling` and/or reset `POLL_PID` when the child exits.

---

## Major

### 5. No error handling for `hyprctl`
**Function:** `get_window_states`, lines 117–118

If `hyprctl` fails or returns invalid JSON, the jq pipeline silently produces empty output, causing incorrect "no windows" decisions.

```bash
monitors=$(hyprctl monitors -j 2>/dev/null) || return 1
clients=$(hyprctl clients -j 2>/dev/null) || return 1
```

### 6. No error handling for `mv` in `update_rules`
**Line:** 324

If the atomic replace fails, the rules file may be left deleted. Check `mv` exit status and clean up the temp file on failure.

```bash
if ! mv "$temp_file" "$RULES_FILE"; then
    printf 'ERROR: Failed to update rules file\n' >&2
    rm -f "$temp_file"
    return 1
fi
```

### 7. Excessive disk I/O in polling loop
**Function:** `check_and_save_with_state`, line 346

`STATE_FILE` is written unconditionally every 0.25–0.5s regardless of whether state changed — 100–200 writes/minute. Move the write inside the `states_changed` branch.

### 8. Regex bug in `load_rules_cache`
**Line:** 250

Pattern `match:[a-zA-Z]+` doesn't match `match:initial_class` or `match:initial_title` (missing `_`). Should be `[a-zA-Z_]+`, consistent with `parse_matchers` at line 54.

### 9. Broken pattern escaping in `update_rules`
**Lines:** 283–290

The "escape" branch for regex-containing patterns does nothing — it assigns `escaped_pattern="$pattern"` unchanged. Either actually escape or document that patterns must already be in valid windowrule syntax.

### 10. Inefficient jq loop
**Function:** `get_window_states`, lines 95–113

Spawns a new `jq` process per matcher to build the JSON array. Build the array in one pass with a single `jq` call instead.

---

## Minor

### 11. No socket existence check
**Line:** 496

If `$HYPRLAND_INSTANCE_SIGNATURE` is unset or the socket doesn't exist, `socat` fails silently and the script exits without explanation. Validate both before connecting.

### 12. Orphaned zombie processes
**Function:** `stop_polling`

The polling subprocess is killed but never `wait`-ed, leaving a zombie until the parent exits.

```bash
kill "$POLL_PID" 2>/dev/null
wait "$POLL_PID" 2>/dev/null
```

### 13. Double `grep` in `load_patterns`
**Lines:** 28–29

Two grep invocations can be combined into one:

```bash
grep -Ev '^[[:space:]]*(#|$)' "$CONFIG_FILE"
```

### 14. Redundant state fetches in event handlers
**Function:** `handle_event`, lines 421–432

`closewindow*` fetches state twice (once inside `immediate_save`, once after). Refactor to fetch once and pass through.

### 15. `cut` subprocess for hash extraction
**Line:** 230

`md5sum <<< "$new_state" | cut -d' ' -f1` spawns an extra process. Use parameter expansion:

```bash
local hash_output
hash_output=$(md5sum <<< "$new_state")
new_hash="${hash_output%% *}"
```

### 16. Magic poll interval numbers
**Function:** `adaptive_sleep`, lines 180–183

`0.5` and `0.25` should be named constants at the top of the script:

```bash
POLL_INTERVAL_BUSY=0.5
POLL_INTERVAL_IDLE=0.25
```

---

## Nit

### 17. `save_rules` is dead weight
**Lines:** 335–337

One-liner alias for `update_rules` with no added value. Either inline the calls or remove the wrapper.

### 18. Misleading comment on escaping
**Line:** 282

Comment says "Escape pattern for regex" but the code doesn't escape anything. Update to reflect actual behavior.

### 19. `HYPRLAND_INSTANCE_SIGNATURE` not validated at startup

Add an early guard:

```bash
[[ -z "$HYPRLAND_INSTANCE_SIGNATURE" ]] && {
    printf 'ERROR: Not running under Hyprland (HYPRLAND_INSTANCE_SIGNATURE not set)\n' >&2
    exit 1
}
```

### 20. `build_pattern` is dead code
**Lines:** 32–44

`build_pattern` is defined but never called — only `parse_matchers` is used. Remove it.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 4     |
| Major    | 6     |
| Minor    | 6     |
| Nit      | 4     |

The script is well-structured with good optimization intent (caching, adaptive polling, SCHED_IDLE). The critical issues — insecure `/tmp` usage, unguarded `mktemp`, the stale state fallback, and the polling PID race — should be addressed first. The regex bug in `load_rules_cache` (#8) is a silent correctness failure that would cause `initial_class`/`initial_title` rules to never be restored after a config reload.
