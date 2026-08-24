#!/usr/bin/env bash

# AGS Daemons Starter Script
# Starts AGS with shell surfaces at login and utility modules on demand.

# ============================================================================
# Configuration
# ============================================================================

AGS_CONFIG_DIR="$HOME/.config/ags"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-}"
LOG_FILE=""
PROFILECTL="$HOME/.config/hypr/runtime/profiles/profilectl.sh"

# Bundled shell settings
BUNDLED_CONFIG="config-bundled.tsx"
BUNDLED_INSTANCE="ags-bundled"
BUNDLED_START_LOCK=""

# shellcheck source=.config/ags/scripts/runtime-artifacts.sh
source "$AGS_CONFIG_DIR/scripts/runtime-artifacts.sh"

# Let GJS resolve GIR typelibs exported by the current Nix system profile.
# EDS calendar loading also needs transitive typelibs, e.g. libical and json-glib,
# to be present in the profile that provides this directory.
SYSTEM_GI_TYPELIB_PATH="/run/current-system/sw/lib/girepository-1.0"

# Startup behavior
WAIT_FOR_HYPRLAND=true           # Wait for Hyprland to be ready before starting
HYPRLAND_TIMEOUT=4               # Max time to wait for first Hyprland event (seconds)

# ============================================================================
# Helper Functions
# ============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "[$(date +'%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Check if bundled instance is running
is_bundled_running() {
    local instances
    if ! instances="$(ags list 2>/dev/null)"; then
        return 2
    fi
    grep -q "$BUNDLED_INSTANCE" <<< "$instances"
}

process_identity() {
    local pid="$1"
    awk -v pid="$pid" '{print pid ":" $22; exit}' "/proc/${pid}/stat" 2>/dev/null || true
}

stop_owned_process() {
    local pid="$1"
    local identity="$2"
    if [[ -z "$identity" ]]; then
        wait "$pid" 2>/dev/null || true
        return
    fi
    if [[ "$(process_identity "$pid")" != "$identity" ]]; then
        return
    fi
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
        if ! kill -0 "$pid" 2>/dev/null; then
            wait "$pid" 2>/dev/null || true
            return
        fi
        sleep 0.1
    done
    if [[ "$(process_identity "$pid")" == "$identity" ]]; then
        kill -KILL "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
}

release_start_lock() {
    local fd="$1"
    flock -u "$fd" 2>/dev/null || true
    exec {fd}>&-
}

# Wait for Hyprland to be ready by listening for first event
wait_for_hyprland() {
    if [[ "$WAIT_FOR_HYPRLAND" != "true" ]]; then
        log "${BLUE}ℹ${NC} Hyprland wait disabled, starting immediately"
        return 0
    fi

    local socket="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock"
    
    # Check if socket exists
    if [[ ! -S "$socket" ]]; then
        log "${YELLOW}⚠${NC} Hyprland socket not found, starting immediately"
        return 0
    fi
    
    log "${BLUE}⏳${NC} Waiting for Hyprland to be ready..."
    
    # Listen for first event with timeout
    # Any event means Hyprland is initialized and ready
    if timeout "$HYPRLAND_TIMEOUT" socat -u "UNIX-CONNECT:$socket" - 2>/dev/null | head -n 1 >/dev/null; then
        log "${GREEN}✓${NC} Hyprland ready, starting daemons..."
        return 0
    else
        log "${YELLOW}⚠${NC} Timeout waiting for Hyprland, starting anyway..."
        return 0
    fi
}

# ============================================================================
# Main Function
# ============================================================================

main() {
    if ! require_private_runtime_directory; then
        printf '%s\n' "$RUNTIME_ARTIFACT_ERROR" >&2
        return 1
    fi
    RUNTIME_DIR="$XDG_RUNTIME_DIR"
    LOG_FILE="$RUNTIME_DIR/ags-daemons.log"
    BUNDLED_START_LOCK="$RUNTIME_DIR/ags-bundled-start.lock"

    log "════════════════════════════════════════"
    log "${GREEN}AGS Bundled Startup${NC}"
    log "════════════════════════════════════════"
    
    # Wait for Hyprland to be ready (listen for first event)
    wait_for_hyprland

    if [[ -x "$PROFILECTL" ]] && ! "$PROFILECTL" reconcile; then
        log "${YELLOW}⚠${NC} Failed to initialize profile state"
    fi
    
    # Start the AGS process. Utility modules remain unloaded until requested.
    log "${BLUE}🚀${NC} Starting bundled AGS..."
    
    local bundled_probe_status
    local pid_identity

    if ! prepare_runtime_lock "$BUNDLED_START_LOCK"; then
        log "${RED}✗${NC} $RUNTIME_ARTIFACT_ERROR"
        return 1
    fi
    exec {startup_lock_fd}<>"$RUNTIME_LOCK_PATH"
    if ! flock -w 10 "$startup_lock_fd"; then
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} Timed out waiting for bundled AGS startup lock"
        return 1
    fi
    
    # Check if bundled config exists
    if [[ ! -f "$AGS_CONFIG_DIR/$BUNDLED_CONFIG" ]]; then
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} Bundled config not found: $AGS_CONFIG_DIR/$BUNDLED_CONFIG"
        return 1
    fi
    
    # Check if already running
    is_bundled_running
    bundled_probe_status=$?
    if [[ "$bundled_probe_status" -eq 0 ]]; then
        release_start_lock "$startup_lock_fd"
        log "${YELLOW}⚠${NC} Bundled daemon already running: $BUNDLED_INSTANCE"
        return 0
    fi
    if [[ "$bundled_probe_status" -eq 2 ]]; then
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} Failed to query running AGS instances"
        return 1
    fi
    
    # AGS can run TypeScript directly.
    log "${BLUE}→${NC} Launching bundled process: $BUNDLED_CONFIG"
    if [[ -d "$SYSTEM_GI_TYPELIB_PATH" ]]; then
        export GI_TYPELIB_PATH="$SYSTEM_GI_TYPELIB_PATH${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
    fi
    if ! publish_runtime_artifacts session; then
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} $RUNTIME_ARTIFACT_ERROR"
        return 1
    fi
    if [[ -n "$RUNTIME_ARTIFACT_WARNING" ]]; then
        log "${YELLOW}⚠${NC} $RUNTIME_ARTIFACT_WARNING"
    fi
    if [[ "$RUNTIME_ARTIFACT_BUNDLED_HOST_READY" == "true" ]]; then
        (exec {startup_lock_fd}>&-; exec "$AGS_CONFIG_DIR/scripts/run-runtime-artifact-host.sh" \
            "$AGS_RUNTIME_ARTIFACT_GENERATION_DIR" \
            "$AGS_CONFIG_DIR" \
            ags-bundle-runtime \
            "$AGS_BUNDLED_EXECUTABLE_PATH") &
    else
        # compatibility: remove after ags-bundle-runtime is deployed on every host.
        (exec {startup_lock_fd}>&-; exec "$AGS_CONFIG_DIR/scripts/run-runtime-artifact-host.sh" \
            "$AGS_RUNTIME_ARTIFACT_GENERATION_DIR" \
            "$AGS_CONFIG_DIR" \
            ags \
            run \
            "$BUNDLED_CONFIG") &
    fi
    local pid=$!
    pid_identity="$(process_identity "$pid")"
    
    # Wait for initialization
    sleep 2.0
    
    # Verify bundled instance is running
    log "${BLUE}ℹ${NC} Verifying bundled daemon..."
    
    if is_bundled_running; then
        release_start_lock "$startup_lock_fd"
        log "${GREEN}✓${NC} Bundled daemon started successfully: $BUNDLED_INSTANCE"
        log "${BLUE}ℹ${NC} Bundled owner PID: $pid"
        log "${GREEN}✓${NC} Shell components initialized; utility modules remain lazy"
        log "════════════════════════════════════════"
        return 0
    else
        stop_owned_process "$pid" "$pid_identity"
        cleanup_runtime_artifacts
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} Failed to start bundled daemon: $BUNDLED_INSTANCE"
        log "════════════════════════════════════════"
        return 1
    fi
}

# ============================================================================
# Execution
# ============================================================================

main "$@"
