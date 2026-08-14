# Architecture and Components

AGS runs in bundled mode for performance. Shell components load from
`config-bundled.tsx` at startup. Task-oriented system windows are separate
modules loaded by `services/utility-manager.ts` on first use, keeping their
dependencies out of the login path while retaining one GTK process.

Shell components (in `components/`):

- `components/confirm-dialog.tsx` - Confirmation dialog for high-impact operations
- `components/keyboard-switcher.tsx` - Keyboard layout switcher overlay
- `components/volume-indicator.tsx` - Volume change indicator with automatic monitoring
- `components/start-menu/index.tsx` - System start menu with update badges
- `components/start-menu/recent-items-menu.tsx` - Display-only Recent Items submenu
- `components/window-switcher/` - Alt+Tab window switcher with previews and session state

Lazy utility components (in `components/`):

- `components/about-this-pc.tsx` - On-demand system information window
- `components/force-quit.tsx` - On-demand application termination window

Services (in `services/`):

- `services/app-icons.ts` - Application identity and icon resolution
- `services/hyprland-ipc.ts` - Hyprland socket discovery and request helpers
- `services/recent-applications.ts` - Session-scoped focus history
- `services/recent-documents.ts` - XBEL-backed recent document history
- `services/performance-monitor.ts` - Shared performance instrumentation

Entry points:

- `config-bundled.tsx` - Main bundled configuration
- `services/utility-manager.ts` - Lazy utility loader and request router
- `start-daemons.sh` - Boot script to start AGS in bundled mode

Bundled mode details:

- `ags-bundled` starts at login and hosts all windows.
- Shell components initialize at startup; About This PC and Force Quit load on
  their first request through `UtilityManager`.
- The bundled registry routes utility IPC requests through `UtilityManager`
  without loading a utility for an `is-visible` query.
- Shell components open utilities through `UtilityManager`, not direct
  `globalThis` references.
- Each component window has its own namespace and applies CSS through AGS APIs.

File structure:

```
.config/ags/
├── components/                 # GTK surfaces and shared widgets
│   └── start-menu/             # Start Menu vertical feature slice
├── services/                   # Runtime state, integrations, and lazy loading
├── config-bundled.tsx          # Main bundled entry point
└── start-daemons.sh            # Boot script (runs config-bundled.tsx)
```
