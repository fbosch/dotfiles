#!/usr/bin/env bash

# AGS Daemons Starter Script
# Starts AGS with shell surfaces at login and utility modules on demand.

# ============================================================================
# Configuration
# ============================================================================

AGS_CONFIG_DIR="$HOME/.config/ags"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
LOG_FILE="$RUNTIME_DIR/ags-daemons.log"
PROFILECTL="$HOME/.config/hypr/runtime/profiles/profilectl.sh"

# Bundled shell settings
BUNDLED_CONFIG="config-bundled.tsx"
BUNDLED_INSTANCE="ags-bundled"
BUNDLED_START_LOCK="$RUNTIME_DIR/ags-bundled-start.lock"
AI_POINTER_HELPER_CONFIG="components/ai-pointer/accessibility/helper.ts"
AI_POINTER_MODULE_CONFIG="components/ai-pointer/index.tsx"
ABOUT_THIS_PC_CONFIG="config-about-this-pc.tsx"

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
    ags list 2>/dev/null | grep -q "$BUNDLED_INSTANCE"
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
    
    local bundled_config="$AGS_CONFIG_DIR/$BUNDLED_CONFIG"
    local bundled_executable="$RUNTIME_DIR/ags-bundled-executable"
    local bundled_candidate="$bundled_executable.$$"
    local ai_pointer_helper="$RUNTIME_DIR/ags-ai-pointer-accessibility-helper"
    local ai_pointer_helper_candidate="$ai_pointer_helper.$$"
    local ai_pointer_helper_config="$AGS_CONFIG_DIR/$AI_POINTER_HELPER_CONFIG"
    local ai_pointer_module="$RUNTIME_DIR/ags-ai-pointer-module.js"
    local ai_pointer_module_candidate="$ai_pointer_module.$$"
    local ai_pointer_module_config="$AGS_CONFIG_DIR/$AI_POINTER_MODULE_CONFIG"
    local about_this_pc_config="$AGS_CONFIG_DIR/$ABOUT_THIS_PC_CONFIG"
    local about_this_pc_executable="$RUNTIME_DIR/ags-about-this-pc-executable"
    local about_this_pc_candidate="$about_this_pc_executable.$$"
    local about_this_pc_bundled=false
    local pid_identity

    exec {startup_lock_fd}>"$BUNDLED_START_LOCK"
    if ! flock -w 10 "$startup_lock_fd"; then
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} Timed out waiting for bundled AGS startup lock"
        return 1
    fi
    
    # Check if bundled config exists
    if [[ ! -f "$bundled_config" ]]; then
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} Bundled config not found: $bundled_config"
        return 1
    fi
    if [[ ! -f "$ai_pointer_helper_config" ]]; then
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} AI Pointer helper not found: $ai_pointer_helper_config"
        return 1
    fi
    if [[ ! -f "$ai_pointer_module_config" ]]; then
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} AI Pointer module not found: $ai_pointer_module_config"
        return 1
    fi
    if [[ ! -f "$about_this_pc_config" ]]; then
        rm -f "$about_this_pc_executable"
        log "${YELLOW}⚠${NC} About This PC config not found: $about_this_pc_config"
    fi
    
    # Check if already running
    if is_bundled_running; then
        release_start_lock "$startup_lock_fd"
        log "${YELLOW}⚠${NC} Bundled daemon already running: $BUNDLED_INSTANCE"
        return 0
    fi
    
    # AGS can run TypeScript directly.
    log "${BLUE}→${NC} Launching bundled process: $BUNDLED_CONFIG"
    if [[ -d "$SYSTEM_GI_TYPELIB_PATH" ]]; then
        export GI_TYPELIB_PATH="$SYSTEM_GI_TYPELIB_PATH${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
    fi
    if ! (cd "$AGS_CONFIG_DIR" && ags bundle --gtk 4 "$AI_POINTER_HELPER_CONFIG" "$ai_pointer_helper_candidate"); then
        rm -f "$ai_pointer_helper_candidate"
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} Failed to build AI Pointer accessibility helper"
        return 1
    fi
    if ! (cd "$AGS_CONFIG_DIR" && python3 scripts/build-ags-module.py --gtk 4 "$AI_POINTER_MODULE_CONFIG" "$ai_pointer_module_candidate"); then
        rm -f "$ai_pointer_helper_candidate" "$ai_pointer_module_candidate"
        release_start_lock "$startup_lock_fd"
        log "${RED}✗${NC} Failed to build AI Pointer module"
        return 1
    fi
    if command -v ags-bundle-runtime >/dev/null 2>&1; then
        if ! (cd "$AGS_CONFIG_DIR" && ags bundle "$BUNDLED_CONFIG" "$bundled_candidate"); then
            rm -f "$bundled_candidate" "$about_this_pc_candidate" "$ai_pointer_helper_candidate" "$ai_pointer_module_candidate"
            release_start_lock "$startup_lock_fd"
            log "${RED}✗${NC} Failed to build bundled AGS executable"
            return 1
        fi
        if [[ -f "$about_this_pc_config" ]]; then
            if (cd "$AGS_CONFIG_DIR" && ags bundle "$ABOUT_THIS_PC_CONFIG" "$about_this_pc_candidate"); then
                about_this_pc_bundled=true
            else
                rm -f "$about_this_pc_candidate" "$about_this_pc_executable"
                log "${YELLOW}⚠${NC} Failed to build About This PC; source fallback will be used"
            fi
        fi
        mv -f "$bundled_candidate" "$bundled_executable"
        if [[ "$about_this_pc_bundled" == "true" ]]; then
            mv -f "$about_this_pc_candidate" "$about_this_pc_executable"
        fi
        mv -f "$ai_pointer_helper_candidate" "$ai_pointer_helper"
        mv -f "$ai_pointer_module_candidate" "$ai_pointer_module"
        (exec {startup_lock_fd}>&-; exec ags-bundle-runtime "$bundled_executable") &
    else
        # compatibility: remove after ags-bundle-runtime is deployed on every host.
        mv -f "$ai_pointer_helper_candidate" "$ai_pointer_helper"
        mv -f "$ai_pointer_module_candidate" "$ai_pointer_module"
        (exec {startup_lock_fd}>&-; cd "$AGS_CONFIG_DIR" && exec ags run "$BUNDLED_CONFIG") &
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
        log "${BLUE}ℹ${NC} Bundled PID: $pid"
        log "${GREEN}✓${NC} Shell components initialized; utility modules remain lazy"
        log "════════════════════════════════════════"
        return 0
    else
        stop_owned_process "$pid" "$pid_identity"
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
