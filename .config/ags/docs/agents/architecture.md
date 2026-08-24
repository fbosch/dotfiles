# Architecture and Components

AGS runs in bundled mode for performance. Shell components load from
`config-bundled.tsx` at startup. The utility manager loads occasional features
on first use. Force Quit and AI Pointer stay in the bundled GTK process; About
This PC uses a short-lived process so its retained memory can be reclaimed.

Shell components (in `components/`):

- `components/confirm-dialog/` - Confirmation dialog for allow-listed high-impact operations
- `components/keyboard-switcher/` - Keyboard layout switcher overlay
- `components/volume-indicator/` - Volume change indicator with automatic monitoring
- `components/start-menu/index.tsx` - System start menu with update badges
- `components/start-menu/recent-items-menu.tsx` - Display-only Recent Items submenu
- `components/window-switcher/` - Alt+Tab window switcher with previews and session state

Lazy utility components (in `components/`):

- `components/about-this-pc/` - On-demand system information feature slice
- `components/ai-pointer/` - On-demand pointer capture and question workflow
- `components/force-quit/` - On-demand application termination feature slice

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
- Shell components initialize at startup; About This PC, AI Pointer, and Force
  Quit load on their first request through `UtilityManager`.
- AI Pointer loads from a host-specific `ags-ai-pointer-module-*.js` so the main
  bundle does not parse its feature graph during login. The module still runs
  in `ags-bundled`.
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
