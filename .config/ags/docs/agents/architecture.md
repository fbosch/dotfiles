# Architecture and Components

AGS runs in bundled mode for performance. All components in `lib/` are imported by `config-bundled.tsx` and run in a single GTK process.

Components (in `lib/`):

- `lib/confirm-dialog.tsx` - Confirmation dialog for high-impact operations
- `lib/keyboard-switcher.tsx` - Keyboard layout switcher overlay
- `lib/volume-indicator.tsx` - Volume change indicator with automatic monitoring
- `lib/start-menu.tsx` - System start menu with update badges
- `lib/window-switcher.tsx` - Alt+Tab window switcher with previews

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
