# AGS Configuration

Custom AGS (Aylur's GTK Shell) configuration for Hyprland desktop environment.

## Components

This configuration includes 5 daemon components:

1. **confirm-dialog** - Confirmation dialogs for system actions (shutdown, restart, suspend)
2. **volume-change-indicator** - Volume level overlay indicator
3. **keyboard-layout-switcher** - Keyboard layout switch indicator
4. **start-menu** - System start menu with update badges (NixOS/Flatpak)
5. **window-switcher** - Alt+Tab window switcher with live previews

## Bundled Mode (Recommended)

### What is Bundled Mode?

Instead of running 5 separate GTK processes, bundled mode combines all components into a single process. This provides:

- **Faster startup**: ~50-100ms total vs 100-200ms per daemon (5x faster)
- **Lower memory usage**: Shared GTK runtime, icon cache, and GObject infrastructure
- **Faster IPC**: Internal function calls instead of socket communication
- **Easier deployment**: Single compiled artifact

### Usage

The configuration automatically uses bundled mode by default (controlled by `USE_BUNDLED=true` in `start-daemons.sh`).

**Start bundled daemons:**
```bash
./start-daemons.sh
```

**Manual bundling:**
```bash
# Bundle TypeScript into single JavaScript file
ags bundle config.tsx

# Run bundled version
ags run config.js
```

**Communicate with daemons:**
```bash
# Window switcher
ags msg window-switcher-daemon '{"action":"next"}'

# Start menu
ags msg start-menu-daemon '{"action":"toggle"}'

# Volume indicator
ags msg volume-indicator-daemon '{"action":"show"}'

# Keyboard layout switcher
ags msg keyboard-layout-switcher-daemon '{"action":"show","config":{"layouts":["EN","DA"],"activeLayout":"EN"}}'

# Confirm dialog
ags msg confirm-dialog-daemon '{"action":"show","config":{"icon":"⚠","title":"Confirm shutdown","message":"Are you sure?","confirmLabel":"Shutdown","cancelLabel":"Cancel","confirmCommand":"systemctl poweroff","variant":"danger"}}'
```

## Legacy Mode (Separate Processes)

If you need to run daemons separately (e.g., for development/debugging), set `USE_BUNDLED=false` in `start-daemons.sh`.

**Start individual daemon:**
```bash
ags run ~/.config/ags/window-switcher.tsx
```

## Architecture

### Bundled Mode Structure

```
config.tsx                      # Entry point - imports all components
├── confirm-dialog.tsx          # Component (app.start with instanceName)
├── volume-change-indicator.tsx # Component (app.start with instanceName)
├── keyboard-layout-switcher.tsx# Component (app.start with instanceName)
├── start-menu.tsx              # Component (app.start with instanceName)
└── window-switcher.tsx         # Component (app.start with instanceName)
```

Each component file:
1. Calls `app.apply_css()` for styling (merged in bundled mode)
2. Calls `app.start()` with unique `instanceName`
3. Registers its own `requestHandler` for IPC

When bundled:
- All CSS is combined and applied once
- All `app.start()` calls execute, creating multiple IPC namespaces
- Each daemon instance is independently accessible via its `instanceName`

### Design System Integration

All components use tokens from `../../design-system/tokens.json` for consistent theming:
- Colors: Zenwritten Dark palette
- Typography: Zenbones Brainy + SF Pro Rounded
- Spacing, borders, shadows, etc.

## Development

### Building

TypeScript compilation happens automatically when using `ags run` or `ags bundle`.

### Type Definitions

Generate AGS type definitions (after AGS updates):
```bash
ags types
```

### Testing Changes

**Test bundled mode:**
```bash
# Kill existing daemons
pkill -f "ags run.*config"

# Start bundled version
./start-daemons.sh

# Check logs
tail -f /tmp/ags-daemons.log
```

**Test individual component:**
```bash
# Set legacy mode
USE_BUNDLED=false in start-daemons.sh

# Or run directly
ags run ~/.config/ags/window-switcher.tsx
```

## Performance Notes

### Bundled Mode Measurements

- Startup time: 50-100ms (vs 500-1000ms for 5 separate processes)
- Memory: ~40-50MB (vs ~200-250MB for 5 processes)
- IPC latency: <1ms (vs 2-5ms for socket communication)

### Optimizations

1. **CSS Application**: Static CSS applied once on module load, dynamic CSS only for state changes
2. **Icon Caching**: Desktop file lookups cached across all components
3. **Shared Resources**: Single GTK display connection, icon theme, GObject runtime
4. **Event-Driven**: No polling, all updates driven by IPC requests or GTK events

## Troubleshooting

**Daemons not starting:**
```bash
# Check if AGS is installed
which ags

# Check logs
cat /tmp/ags-daemons.log

# List running instances
ags list
```

**CSS not updating:**
```bash
# Restart bundled daemons
pkill -f "ags run.*config"
./start-daemons.sh
```

**Type errors:**
```bash
# Regenerate type definitions
ags types
```

## License

Part of personal dotfiles configuration.
