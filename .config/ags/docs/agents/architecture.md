# Architecture and Components

AGS runs in bundled mode for performance. Components are imported by `config-bundled.tsx` and run in a single GTK process, while services own shared state and runtime integrations.

Components (in `components/`):

- `components/confirm-dialog.tsx` - Confirmation dialog for high-impact operations
- `components/keyboard-switcher.tsx` - Keyboard layout switcher overlay
- `components/volume-indicator.tsx` - Volume change indicator with automatic monitoring
- `components/start-menu.tsx` - System start menu with update badges
- `components/recent-items-menu.tsx` - Display-only Recent Items submenu
- `components/window-switcher.tsx` - Alt+Tab window switcher with previews

Services (in `services/`):

- `services/app-icons.ts` - Application identity and icon resolution
- `services/hyprland-ipc.ts` - Hyprland socket discovery and request helpers
- `services/recent-applications.ts` - Session-scoped focus history
- `services/performance-monitor.ts` - Shared performance instrumentation

Entry points:

- `config-bundled.tsx` - Main bundled configuration (imports all components)
- `start-daemons.sh` - Boot script to start AGS in bundled mode

Bundled mode details:

- Each component window has its own namespace
- CSS is applied during module loading
- Components export to `globalThis` for communication
- Single GTK process hosts all windows

File structure:

```
.config/ags/
├── components/                 # GTK surfaces and shared widgets
├── services/                   # Runtime state and integrations
├── config-bundled.tsx          # Main entry point (imports components/)
└── start-daemons.sh            # Boot script (runs config-bundled.tsx)
```
