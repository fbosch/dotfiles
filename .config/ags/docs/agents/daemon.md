# Daemon Lifecycle

## Overview

AGS runs as a single bundled process started at boot. All components are loaded into one process with shared resources for instant UI display and efficient usage.

## Boot process

1. Hyprland starts and runs `~/.config/ags/start-daemons.sh`
2. Script waits for Hyprland to be ready
3. Launches `ags run config-bundled.tsx`
4. Components initialize in a single process
5. Windows are pre-created (hidden) for instant display

## Startup script (`start-daemons.sh`)

Purpose: manage the bundled AGS process lifecycle.

Features:

- Waits for Hyprland to be ready before starting
- Checks if bundled process is already running
- Provides colored console output and logging
- Logs to `/tmp/ags-daemons.log` for debugging

Usage:

```bash
exec-once = uwsm app -- ~/.config/ags/start-daemons.sh
~/.config/ags/start-daemons.sh
cat /tmp/ags-daemons.log
ags list
```

Configuration (top of `start-daemons.sh`):

```bash
WAIT_FOR_HYPRLAND=true
HYPRLAND_TIMEOUT=4
```

## Communication pattern

Components communicate via the `globalThis` namespace.

Component side (TypeScript in `lib/` files):

```tsx
globalThis.myComponent = {
  show: () => myWindow.show(),
  hide: () => myWindow.hide(),
  toggle: () => myWindow.visible ? myWindow.hide() : myWindow.show(),
};

const myWindow = (
  <window name="my-window" namespace="ags-myapp" visible={false}>
    {/* content */}
  </window>
);
```

Main config (`config-bundled.tsx`):

```tsx
import "gi://Astal?version=4.0";
import app from "ags/gtk4/app";

import "./lib/confirm-dialog.tsx";
import "./lib/keyboard-switcher.tsx";
import "./lib/volume-indicator.tsx";
import "./lib/start-menu.tsx";
import "./lib/window-switcher.tsx";

app.start({
  instanceName: "ags-bundled",
  requestHandler(argv: string[], res: (response: string) => void) {
    try {
      const data = JSON.parse(argv.join(" "));
      const component = globalThis[data.window];

      if (component && typeof component[data.action] === "function") {
        component[data.action]();
        res("success");
      } else {
        res("unknown window or action");
      }
    } catch (e) {
      res(`error: ${e}`);
    }
  },
});
```

Client side (shell):

```bash
ags request -i ags-bundled '{"window":"start-menu","action":"toggle"}'
bind = $mainMod, X, exec, ags request -i ags-bundled '{"window":"start-menu","action":"toggle"}'
```
