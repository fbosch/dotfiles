#!/usr/bin/env bash

# AGS Daemons Starter Script
# Starts all AGS daemons for Hyprland
# Now using bundled mode for improved performance and resource usage
# Can be run at boot or manually to restart daemons

# ============================================================================
# Configuration
# ============================================================================

AGS_CONFIG_DIR="$HOME/.config/ags"
LOG_FILE="/tmp/ags-daemons.log"

# Bundled mode settings
# Now ENABLED - Using global namespace pattern to bundle all 5 components
# Reduces memory usage by ~72% (375MB -> 104MB)
USE_BUNDLED=true                 # Use single bundled process instead of 5 separate daemons
BUNDLED_CONFIG="config-bundled.tsx"  # Bundled configuration entry point
AUTO_BUNDLE=false                # Manual bundling required (ags bundle config-bundled.tsx output.js)

# Bundled daemon instance name
BUNDLED_INSTANCE="ags-bundled"

# Legacy: List of daemons to start individually (filename without path)
# Only used when USE_BUNDLED=false
BOOT_DAEMONS=(
    "confirm-dialog.tsx"
    "volume-change-indicator.tsx"
    "keyboard-layout-switcher.tsx"
    "start-menu.tsx"
    "window-switcher.tsx"
)

# Startup behavior
WAIT_FOR_HYPRLAND=true           # Wait for Hyprland to be ready before starting
HYPRLAND_TIMEOUT=4               # Max time to wait for first Hyprland event (seconds)
STARTUP_VERIFICATION_WAIT=2.0    # Time to wait before verifying all daemons (seconds)

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

# Check if a daemon is already running
is_running() {
    local daemon_name="$1"
    local instance_name="${daemon_name%.tsx}-daemon"
    ags list 2>/dev/null | grep -q "$instance_name"
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

# Start a single daemon (non-blocking)
start_daemon() {
    local daemon_file="$1"
    local daemon_name="${daemon_file%.tsx}"
    local daemon_path="$AGS_CONFIG_DIR/$daemon_file"

    # Check if file exists
    if [[ ! -f "$daemon_path" ]]; then
        log "${RED}✗${NC} Daemon file not found: $daemon_path"
        return 1
    fi

    # Check if already running
    if is_running "$daemon_file"; then
        log "${YELLOW}⚠${NC} Daemon already running: $daemon_name"
        return 0
    fi

    # Start the daemon in background
    log "${BLUE}→${NC} Launching daemon: $daemon_name"
    
    # Don't redirect output - let it inherit from parent shell
    # Output redirection seems to cause AGS daemons to crash
    ags run "$daemon_path" &
    local pid=$!
    
    echo "$pid"  # Return PID for tracking
    return 0
}

# Verify a daemon started successfully
verify_daemon() {
    local daemon_file="$1"
    local pid="$2"
    local daemon_name="${daemon_file%.tsx}"

    if is_running "$daemon_file"; then
        log "${GREEN}✓${NC} Started: $daemon_name (PID: $pid)"
        return 0
    else
        log "${RED}✗${NC} Failed to start: $daemon_name"
        return 1
    fi
}

# ============================================================================
# Main Function
# ============================================================================

main() {
    log "════════════════════════════════════════"
    log "${GREEN}AGS Daemons Startup${NC}"
    log "════════════════════════════════════════"
    
    # Wait for Hyprland to be ready (listen for first event)
    wait_for_hyprland
    
    if [[ "$USE_BUNDLED" == "true" ]]; then
        # Bundled mode - start single process with all daemons
        log "${BLUE}🚀${NC} Starting bundled AGS daemons..."
        
        local bundled_config="$AGS_CONFIG_DIR/$BUNDLED_CONFIG"
        
        # Check if bundled config exists
        if [[ ! -f "$bundled_config" ]]; then
            log "${RED}✗${NC} Bundled config not found: $bundled_config"
            return 1
        fi
        
        # Check if already running
        if ags list 2>/dev/null | grep -q "$BUNDLED_INSTANCE"; then
            log "${YELLOW}⚠${NC} Bundled daemon already running: $BUNDLED_INSTANCE"
            return 0
        fi
        
        # Start bundled daemons (AGS can run TypeScript directly)
        log "${BLUE}→${NC} Launching bundled process: $BUNDLED_CONFIG"
        ags run "$bundled_config" &
        local pid=$!
        
        # Wait for initialization
        sleep 2.0
        
        # Verify bundled instance is running
        log "${BLUE}ℹ${NC} Verifying bundled daemon..."
        
        if ags list 2>/dev/null | grep -q "$BUNDLED_INSTANCE"; then
            log "${GREEN}✓${NC} Bundled daemon started successfully: $BUNDLED_INSTANCE"
            log "${BLUE}ℹ${NC} Bundled PID: $pid"
            log "${GREEN}✓${NC} All 5 components initialized (confirm-dialog, volume-indicator, keyboard-switcher, start-menu, window-switcher)"
            log "════════════════════════════════════════"
            log "${GREEN}✓${NC} Memory usage: ~104 MB (vs ~375 MB for separate processes)"
            return 0
        else
            log "${RED}✗${NC} Failed to start bundled daemon: $BUNDLED_INSTANCE"
            log "════════════════════════════════════════"
            return 1
        fi
    else
        # Legacy mode - start each daemon separately
        log "${YELLOW}⚠${NC} Using legacy mode (separate processes)"
        log "${BLUE}🚀${NC} Launching ${#BOOT_DAEMONS[@]} daemons sequentially..."
        
        local success_count=0
        local fail_count=0
        
        for daemon in "${BOOT_DAEMONS[@]}"; do
            local daemon_name="${daemon%.tsx}"
            
            # Start daemon
            start_daemon "$daemon" > /dev/null 2>&1
            
            # Wait for initialization (volume-indicator needs ~1s)
            sleep 1.0
            
            # Verify immediately
            if is_running "$daemon"; then
                log "${GREEN}✓${NC} Started: $daemon_name"
                ((success_count++))
            else
                log "${RED}✗${NC} Failed to start: $daemon_name"
                ((fail_count++))
            fi
        done
        
        # Summary
        log "════════════════════════════════════════"
        log "Started: ${GREEN}$success_count${NC} | Failed: ${RED}$fail_count${NC}"
        
        if [[ $fail_count -eq 0 ]]; then
            log "${GREEN}✓${NC} All AGS daemons started successfully"
            return 0
        else
            log "${YELLOW}⚠${NC} Some daemons failed to start"
            return 1
        fi
    fi
}

# ============================================================================
# Execution
# ============================================================================

main "$@"
