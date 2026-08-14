# Daemon Lifecycle

## Overview

AGS runs as a single bundled process started at boot. Shell components are
initialized at startup for immediate desktop interaction. Task-oriented system
windows load on demand through the utility manager.

## Boot process

1. Hyprland starts and runs `~/.config/ags/start-daemons.sh`
2. Script waits for Hyprland to be ready
3. Launches `ags run config-bundled.tsx`
4. Shell components initialize in one process
5. `services/utility-manager.ts` imports a utility component when it is first
   requested

## Startup script (`start-daemons.sh`)

Purpose: manage the bundled AGS process lifecycle.

Features:

- Waits for Hyprland to be ready before starting
- Checks if bundled process is already running
- Provides colored console output and logging
- Logs to `/tmp/ags-daemons.log` for debugging

Usage:

```bash
exec-once = uwsm-app -- ~/.config/ags/start-daemons.sh
~/.config/ags/start-daemons.sh
cat /tmp/ags-daemons.log
ags list
```

Configuration (top of `start-daemons.sh`):

```bash
WAIT_FOR_HYPRLAND=true
HYPRLAND_TIMEOUT=4
```

## Communication Pattern

Components communicate via the `globalThis` namespace inside the bundled
process. Shell components do not call utility globals: they request stable
utility IDs through `services/utility-manager.ts`.

Component side (TypeScript in `lib/` files):

```tsx
globalThis.myComponent = {
  show: () => myWindow.show(),
  hide: () => myWindow.hide(),
  toggle: () => (myWindow.visible ? myWindow.hide() : myWindow.show()),
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

import "./components/confirm-dialog.tsx";
import "./components/keyboard-switcher/index.tsx";
import "./components/volume-indicator/index.tsx";
import "./components/start-menu/index.tsx";
import "./components/window-switcher/index.tsx";

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
