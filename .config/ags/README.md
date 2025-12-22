# AGS Configuration

Custom AGS (Aylur's GTK Shell) configuration for Hyprland desktop environment using **bundled mode architecture**.

## Components

This configuration includes 5 components running in a single bundled process:

1. **confirm-dialog** - Confirmation dialogs for system actions (shutdown, restart, suspend)
2. **volume-indicator** - Volume level overlay indicator
3. **keyboard-switcher** - Keyboard layout switch indicator
4. **start-menu** - System start menu with update badges (NixOS/Flatpak)
5. **window-switcher** - Alt+Tab window switcher with live previews

All components are located in the `lib/` directory and bundled via `config-bundled.tsx`.

## Bundled Mode Architecture

### What is Bundled Mode?

Instead of running 5 separate GTK processes, bundled mode combines all components into a single process. This provides:

- **Faster startup**: ~50-100ms total vs 500-1000ms for 5 separate processes (5-10x faster)
- **Lower memory usage**: ~104MB vs ~375MB (72% reduction)
- **Faster IPC**: <1ms internal calls vs 2-5ms socket communication
- **Easier deployment**: Single process hosting all components

### Usage

**Start bundled AGS** (automatically runs at boot via `hyprland.conf`):
```bash
./start-daemons.sh
```

**Manual start:**
```bash
ags run ~/.config/ags/config-bundled.tsx
```

**Communicate with components** (via bundled process):
```bash
# Example IPC format (actual API depends on component implementation)
ags request -i ags-bundled '{"window":"start-menu","action":"toggle"}'
ags request -i ags-bundled '{"window":"window-switcher","action":"next"}'

# See component-specific documentation in AGENTS.md for exact APIs
```

## Architecture

### Bundled Mode Structure

```
.config/ags/
├── lib/                        # Component library (canonical source)
│   ├── confirm-dialog.tsx
│   ├── keyboard-switcher.tsx
│   ├── volume-indicator.tsx
│   ├── start-menu.tsx
│   └── window-switcher.tsx
├── config-bundled.tsx          # Main entry point (imports from lib/)
├── config.tsx                  # Stub (bundled mode required)
└── start-daemons.sh            # Boot script (runs config-bundled.tsx)
```

Each component in `lib/`:
1. Applies CSS for styling
2. Creates windows during module import
3. Exports API to `globalThis` namespace for IPC

When bundled:
- All components are imported into `config-bundled.tsx`
- Single GTK process hosts all windows
- Components communicate via `globalThis` namespace
- `requestHandler` in main config routes IPC calls to components

### Design System Integration

All components use tokens from `../../design-system/tokens.json` for consistent theming:
- Colors: Zenwritten Dark palette
- Typography: Zenbones Brainy + SF Pro Rounded
- Spacing, borders, shadows, etc.

## Development

### Building

TypeScript compilation happens automatically when using `ags run`.

### Type Definitions

Generate AGS type definitions (after AGS updates):
```bash
ags types
```

### Testing Changes

**Test bundled mode:**
```bash
# Kill existing process
pkill -f "ags run.*config-bundled"

# Start bundled version
./start-daemons.sh

# Check logs
tail -f /tmp/ags-daemons.log

# Verify bundled process is running
ags list
```

**Test individual component:**
```bash
# Run component file directly for development
ags run ~/.config/ags/lib/window-switcher.tsx
```

## Performance Notes

### Bundled Mode Measurements

- Startup time: 50-100ms (vs 500-1000ms for 5 separate processes)
- Memory: ~104MB (vs ~375MB for 5 processes)
- IPC latency: <1ms (vs 2-5ms for socket communication)

### Optimizations

1. **CSS Application**: Static CSS applied once on module load, dynamic CSS only for state changes
2. **Window Pre-creation**: Windows created during import for instant display
3. **Shared Resources**: Single GTK display connection, icon theme, GObject runtime
4. **Event-Driven**: No polling, all updates driven by IPC requests or GTK events

## Troubleshooting

**Bundled process not starting:**
```bash
# Check if AGS is installed
which ags

# Check logs
cat /tmp/ags-daemons.log

# Verify bundled process is running
ags list
```

**CSS not updating:**
```bash
# Restart bundled process
pkill -f "ags run.*config-bundled"
./start-daemons.sh
```

**Type errors:**
```bash
# Regenerate type definitions
ags types
```

## License

Part of personal dotfiles configuration.
