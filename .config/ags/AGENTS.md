# AGS Configuration - Agent Guide

## Overview

AGS (Aylur's GTK Shell) configuration for Hyprland UI elements using **bundled mode architecture**.

**Components** (all in `lib/` directory):
- `lib/confirm-dialog.tsx` - Confirmation dialog for high-impact operations
- `lib/keyboard-switcher.tsx` - Keyboard layout switcher overlay
- `lib/volume-indicator.tsx` - Volume change indicator with automatic monitoring
- `lib/start-menu.tsx` - System start menu with update badges
- `lib/window-switcher.tsx` - Alt+Tab window switcher with previews

**Entry Points:**
- `config-bundled.tsx` - Main bundled configuration (imports all components)
- `start-daemons.sh` - Boot script to start AGS in bundled mode

**Important:** 
- AGS no longer uses external CSS files. All styling is done inline via `app.apply_css()` or in the `css` property of `app.start()`.
- All components run as a single bundled process for improved performance.

## Bundled Mode Architecture

### Overview

**Bundled mode combines all 5 components into a single process** for improved performance and resource usage.

**Benefits:**
- ⚡ **Faster startup**: ~50-100ms total vs 500-1000ms for 5 separate processes (5-10x faster)
- 💾 **Lower memory**: ~104MB vs ~375MB (72% reduction)
- 🚀 **Faster IPC**: <1ms internal calls vs 2-5ms socket communication
- 📦 **Single artifact**: One process hosting all components

**How it works:**
- All components from `lib/` are imported into `config-bundled.tsx`
- Each component's window is created with its own namespace
- All CSS is applied during module loading
- Single GTK process hosts all windows
- Components export to `globalThis` namespace for communication

**File Structure:**
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

### Usage

**Start bundled AGS** (automatically runs at boot via `hyprland.conf`):
```bash
./start-daemons.sh
```

**Manual start:**
```bash
ags run ~/.config/ags/config-bundled.tsx
```

**IPC communication** - interact with components via `globalThis` namespace:
```bash
# Example IPC calls (actual API depends on component implementation)
ags msg ags-bundled '{"window":"start-menu","action":"toggle"}'
ags msg ags-bundled '{"window":"window-switcher","action":"next"}'
```

See component-specific sections below for exact IPC APIs.

## Setup

### TypeScript Type Definitions

AGS requires TypeScript type definitions for GObject Introspection libraries (GTK, GLib, etc.). These are auto-generated and stored in `.config/ags/@girs/`.

**Important:** The `@girs/` directory is git-ignored and must be regenerated on new systems.

```bash
# Generate types (run after installing AGS or updating system libraries)
cd ~/.config/ags
ags types

# Types are generated to @girs/ directory
# This typically takes 30-60 seconds
```

**When to regenerate:**
- Fresh system setup
- After updating AGS or system GTK libraries
- If TypeScript shows "Cannot find module" errors for GI imports

## AGS Command Reference

```bash
# Run an AGS app
ags run <file.tsx>

# List running AGS instances
ags list

# Send a request to a running instance
ags request -i <instance-name> '<json-payload>'

# Quit an instance
ags quit <instance-name>

# Toggle window visibility
ags toggle <window-name>

# Generate TypeScript types for GObject Introspection
ags types

# Bundle an app
ags bundle <file.tsx>

# Launch GTK Inspector for debugging
ags inspect

# Start all AGS daemons (wrapper script)
~/.config/ags/start-daemons.sh
```

## TSX/JSX Conventions

**Important:** AGS v3 with Gnim provides full JSX support for GTK widgets. **Always prefer JSX over programmatic widget creation** for cleaner, more maintainable code.

### Property Names
- Use `class` NOT `className` for CSS classes
  ```tsx
  ✅ <box class="my-class">
  ❌ <box className="my-class">
  ```

### Common Widgets
```tsx
// Window with layer shell
<window
  name="window-name"
  namespace="unique-namespace"  // Important for Hyprland layer rules
  visible={true}
  anchor={Astal.WindowAnchor.CENTER}
  layer={Astal.Layer.OVERLAY}  // Use enum, not string!
  exclusivity={Astal.Exclusivity.EXCLUSIVE}
  keymode={Astal.Keymode.EXCLUSIVE}
  class="window-class"
>
  {/* content */}
</window>

// Box container
<box orientation="horizontal" spacing={12} halign="center" class="box-class">
  {/* children */}
</box>

// Button (no type prop in AGS)
<button onClicked={() => {}} class="button-class">
  <label label="Button Text" />
</button>

// Label
<label label="Text content" class="label-class" halign="center" />
```

### Capturing Widget References with `setup`
When you need imperative access to widgets (for updates, class manipulation, etc.), use the `setup` callback:

```tsx
let myLabel: Gtk.Label | null = null;

<label
  label="Initial text"
  setup={(self: Gtk.Label) => {
    myLabel = self;
  }}
/>

// Later, update the label imperatively
myLabel?.set_label("Updated text");
myLabel?.add_css_class("active");
```

### Dynamic Children
For arrays of widgets, use `map` or create them in a loop:

```tsx
// Using map
const items = ["Item 1", "Item 2", "Item 3"];
<box orientation="vertical">
  {items.map(item => <label label={item} />)}
</box>

// Using a loop
const squares: JSX.Element[] = [];
for (let i = 0; i < 20; i++) {
  squares.push(<box class={`square-${i}`} />);
}
<box>{squares}</box>
```

### Common Widgets
```tsx
// Window with layer shell
<window
  name="window-name"
  namespace="unique-namespace"  // Important for Hyprland layer rules
  visible={true}
  anchor={Astal.WindowAnchor.CENTER}
  layer={Astal.Layer.OVERLAY}  // Use enum, not string!
  exclusivity={Astal.Exclusivity.EXCLUSIVE}
  keymode={Astal.Keymode.EXCLUSIVE}
  class="window-class"
>
  {/* content */}
</window>

// Box container
<box orientation="vertical" spacing={12} halign="center" class="box-class">
  {/* children */}
</box>

// Button (no type prop in AGS)
<button onClicked={() => {}} class="button-class">
  <label label="Button Text" />
</button>

// Label
<label label="Text content" class="label-class" halign="center" />
```

### App Structure with Inline CSS
```tsx
import app from "ags/gtk4/app";
import { Astal } from "ags/gtk4";

app.start({
  css: `
    window.my-window {
      background-color: transparent;
    }
    
    box.my-box {
      padding: 20px;
      background-color: rgb(32, 32, 32);
    }
  `,
  main() {
    return (
      <window name="my-window" class="my-window">
        <box class="my-box">
          <label label="Content" />
        </box>
      </window>
    );
  },
});
```

## Styling

### CSS Loading Methods

**Inline CSS (Recommended):**
```tsx
app.start({
  css: `
    /* Your CSS here */
  `,
  main() { /* ... */ }
})
```

**External CSS File:**
```tsx
import css from "./style.css"
app.start({
  css: css,
  main() { /* ... */ }
})
```

**Runtime CSS:**
```tsx
app.apply_css("/path/to/file.css")
app.apply_css(`window { background: red; }`)
app.reset_css()  // Clear all styles
```

### GTK CSS Specifics

**Important:** AGS uses GTK CSS, which differs from web CSS:

1. **Spacing:**
   - GTK `spacing` property on `<box>` is separate from CSS
   - Use CSS `margin` and `padding` for visual spacing
   - `<box spacing={12}>` only affects space between children
   
2. **Selectors:**
   ```css
   /* Element type */
   window { }
   box { }
   button { }
   label { }
   
   /* Class selector */
   .my-class { }
   window.my-window { }
   button.confirm { }
   
   /* Descendant */
   box button { }
   button label { }
   ```

3. **Pseudo-classes:**
   ```css
   button:hover { }
   button:active { }
   button:focus { }
   ```

4. **Common Properties:**
   ```css
   /* GTK supports standard CSS properties */
   padding: 20px;
   margin: 10px;
   background-color: rgb(32, 32, 32);
   color: #ffffff;
   border: 1px solid rgba(255, 255, 255, 0.1);
   border-radius: 12px;
   font-size: 14px;
   font-weight: 600;
   font-family: "SF Pro Rounded", system-ui;
   min-width: 100px;
   min-height: 40px;
   ```

### Design System Alignment
All AGS styles should match the design system from waybar/swaync:

**Colors:**
- Background: `rgb(32, 32, 32)` or `rgba(32, 32, 32, 0.85)`
- Surface: `rgba(45, 45, 45, 0.6)`
- Surface hover: `rgba(55, 55, 55, 0.7)`
- Border: `rgba(255, 255, 255, 0.08)`
- Text primary: `#ffffff`
- Text secondary: `#cccccc`
- Text tertiary: `#999999`
- Accent: `#0067c0`
- Critical: `#c42b1c`
- Warning: `#ff9800`

**Typography:**
- Font family: `"SF Pro Rounded", system-ui, sans-serif`
- Sizes: `13px` (small), `14px` (base), `16px` (default), `20px` (title), `48px` (icon)

**Spacing:**
- Border radius: `6px` (buttons), `12px` (small), `18px` (medium)
- Padding: `10px 32px` (buttons), `32px 40px` (dialog)
- Margins: `8px`, `16px`, `20px`, `24px`

**Transitions:**
- Generally use `transition: none;` for instant appearance
- For hover effects: `background-color` and `border-color` can transition naturally

**Shadows:**
Use elevation system from swaync:
```css
box-shadow: 
  0.4px 0.8px 0.7px hsl(0deg 0% 0% / 0.15),
  0.7px 1.3px 1.1px -1.7px hsl(0deg 0% 0% / 0.12),
  2.4px 4.6px 3.9px -3.3px hsl(0deg 0% 0% / 0.08),
  7.1px 13.6px 11.5px -5px hsl(0deg 0% 0% / 0.04);
```

## Hyprland Integration

### Layer Rules

AGS windows need `namespace` prop for Hyprland layer rules:

```tsx
<window
  name="my-window"
  namespace="ags-myapp"  // Used in Hyprland layerrules
/>
```

In `hyprland.conf`:
```
layerrule = match:namespace ags-myapp, blur on
layerrule = match:namespace ags-myapp, no_anim on
# Don't add ignore_alpha if you want solid backgrounds!
```

**Critical:** Hyprland's `ignore_alpha` rule forces transparency. Only add it if you want the layer to be transparent.

## GJS/GLib Integration

### Spawning Commands
```tsx
const GLib = imports.gi.GLib;

// Async (fire and forget)
GLib.spawn_command_line_async("command arg1 arg2");

// Sync (wait for output)
let [ok, output] = GLib.spawn_command_line_sync("command");
const decoder = new TextDecoder();
let result = JSON.parse(decoder.decode(output));
```

### Keyboard Events
```tsx
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;

// Add as first child of window
<Gtk.EventControllerKey
  onKeyPressed={(_, keyval) => {
    if (keyval === Gdk.KEY_Escape) {
      app.quit();
      return true;  // Event handled
    }
    return false;  // Let event propagate
  }}
/>
```

Common key constants:
- `Gdk.KEY_Escape`
- `Gdk.KEY_Return` (Enter)
- `Gdk.KEY_Tab`
- `Gdk.KEY_space`

### Timeouts
```tsx
const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
  // code
  return GLib.SOURCE_REMOVE;  // or GLib.SOURCE_CONTINUE
});

// Cancel timeout
GLib.source_remove(timeout);
```

### File Monitoring
```tsx
const Gio = imports.gi.Gio;

const file = Gio.File.new_for_path("/path/to/file");
const monitor = file.monitor(Gio.FileMonitorFlags.NONE, null);
monitor.connect('changed', (monitor, file, other_file, event_type) => {
  if (event_type === Gio.FileMonitorEvent.CHANGED) {
    // handle change
  }
});
```

## Daemon Architecture

### Overview
AGS runs as a **single bundled process** started at boot. All 5 components are loaded into one process with shared resources, providing instant UI display and efficient resource usage.

### Lifecycle

**Boot Process:**
1. Hyprland starts and runs `~/.config/ags/start-daemons.sh`
2. Script waits for Hyprland to be ready
3. Launches `ags run config-bundled.tsx`
4. All 5 components initialize in a single process
5. Windows are pre-created (hidden) for instant display

**Components in bundled process:**
- `confirm-dialog` - Always available for confirmation prompts
- `volume-indicator` - Ready to show on volume changes
- `keyboard-switcher` - Pre-initialized for instant display on layout switches
- `start-menu` - Ready to toggle on Super key
- `window-switcher` - Ready for Alt+Tab switching

### Startup Script (`start-daemons.sh`)

**Purpose:** Manages the bundled AGS process lifecycle.

**Location:** `~/.config/ags/start-daemons.sh`

**Features:**
- Waits for Hyprland to be ready before starting
- Checks if bundled process is already running
- Provides colored console output and logging
- Logs to `/tmp/ags-daemons.log` for debugging

**Usage:**
```bash
# Automatic (called from hyprland.conf)
exec-once = uwsm app -- ~/.config/ags/start-daemons.sh

# Manual restart
~/.config/ags/start-daemons.sh

# Check logs
cat /tmp/ags-daemons.log

# Verify bundled process is running
ags list
```

**Configuration:**
Edit the configuration section at the top of `start-daemons.sh`:
```bash
WAIT_FOR_HYPRLAND=true    # Wait for Hyprland to be ready
HYPRLAND_TIMEOUT=4        # Max time to wait for Hyprland (seconds)
```

### Communication Pattern

Components in the bundled process communicate via the `globalThis` namespace:

**Component Side (TypeScript in `lib/` files):**
```tsx
// Export component interface to globalThis
globalThis.myComponent = {
  show: () => myWindow.show(),
  hide: () => myWindow.hide(),
  toggle: () => myWindow.visible ? myWindow.hide() : myWindow.show(),
};

// Component initialization
const myWindow = (
  <window name="my-window" namespace="ags-myapp" visible={false}>
    {/* content */}
  </window>
);
```

**Main Config (`config-bundled.tsx`):**
```tsx
import "gi://Astal?version=4.0";
import app from "ags/gtk4/app";

// Import all components (they register to globalThis)
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

**Client Side (Bash/Shell):**
```bash
# Send request to bundled process
ags request -i ags-bundled '{"window":"start-menu","action":"toggle"}'

# From Hyprland keybind
bind = $mainMod, X, exec, ags request -i ags-bundled '{"window":"start-menu","action":"toggle"}'
```

### Best Practices

1. **Component files in `lib/`** - All components live in the `lib/` directory
2. **Export to `globalThis`** - Make component APIs available for IPC
3. **Pre-create windows** - Create windows during import for instant display
4. **Use unique `namespace`** - Convention: `ags-{component-name}` for layer rules
5. **Keep components stateless** - Refresh state on each show request
6. **Add error handling** - Always wrap JSON parsing in try-catch
7. **CSS namespacing** - Use `window.{component-name}` selectors to avoid conflicts

### Troubleshooting

```bash
# Check if bundled process is running
ags list

# View startup logs
cat /tmp/ags-daemons.log

# Kill and restart
pkill gjs
~/.config/ags/start-daemons.sh

# Test bundled config manually
ags run ~/.config/ags/config-bundled.tsx

# Send test request
ags request -i ags-bundled '{"window":"start-menu","action":"toggle"}'

# Check for errors
journalctl --user -u uwsm-app@Hyprland.service | grep -i ags
```

## Current Implementations

### lib/confirm-dialog.tsx - Confirmation Dialog
- Generic confirmation dialog for high-impact operations
- Supports variant colors (danger/warning/info)
- Pre-creates window during module load for instant display
- Static CSS applied once on module load
- Optional audio alert on show
- Optional display delay
- Bound to various high-impact operations in Hyprland
- Exports to `globalThis.confirmDialog`

### lib/keyboard-switcher.tsx - Layout Switcher Overlay
- Shows current keyboard layout when switching
- Pre-calculates dimensions on module load
- Pre-creates window structure during import
- Caches widget references for fast updates
- Auto-hides after 700ms
- Triggered by `switch-layout.sh` via IPC
- Exports to `globalThis.keyboardSwitcher`

### lib/volume-indicator.tsx - Volume Change Indicator
- macOS-inspired volume overlay with speaker icon, progress bar, and percentage
- Triggered by Hyprland volume keybinds
- Pre-creates window during module load for instant display
- Static CSS applied once on module load
- Shows on volume change, auto-hides after 2 seconds
- 16 progress squares matching macOS style
- Segoe Fluent Icons for speaker states
- Matches design-system VolumeChangeIndicator component
- Bound to volume keybinds in `keybinds.conf`
- Exports to `globalThis.volumeIndicator`

### lib/start-menu.tsx - System Start Menu
- Application launcher and system menu
- Exports to `globalThis.startMenu`
- Bound to Super key in Hyprland

### lib/window-switcher.tsx - Window Switcher
- Alt+Tab style window switcher with previews
- Exports to `globalThis.windowSwitcher`
- Bound to Alt+Tab in Hyprland

## Common Issues

### Window Not Showing
1. **Check if running:** `ags list` or `ps aux | grep gjs`
2. **Check Hyprland layers:** `hyprctl layers -j | jq`
3. **Verify layer enum:** Use `Astal.Layer.OVERLAY` not `"overlay"`
4. **Check namespace:** Window needs `namespace` prop for layer rules
5. **Kill old instances:** `pkill gjs` before testing

### JSX Best Practices

**Always prefer JSX over programmatic widget creation** for better readability and maintainability.

**Good (JSX):**
```tsx
<box orientation="vertical" spacing={8} class="my-box">
  <label label="Hello World" />
  <button onClicked={() => console.log("clicked")}>
    <label label="Click me" />
  </button>
</box>
```

**Avoid (Programmatic):**
```tsx
const box = new Gtk.Box({
  orientation: Gtk.Orientation.VERTICAL,
  spacing: 8
});
box.add_css_class("my-box");

const label = new Gtk.Label({ label: "Hello World" });
box.append(label);

const button = new Gtk.Button();
button.connect("clicked", () => console.log("clicked"));
box.append(button);
```

**When you need widget references**, use the `setup` callback:
```tsx
let myWidget: Gtk.Box | null = null;

<box setup={(self: Gtk.Box) => {
  myWidget = self;
}}>
  {/* content */}
</box>

// Later, update imperatively
myWidget?.add_css_class("active");
```

### GTK CSS Property Limitations
**Invalid GTK CSS properties** (will cause errors):
- `max-width` - Use `min-width` instead or handle with GTK properties
- Web-specific properties like `display`, `flex`, `grid`

**Valid GTK CSS properties:**
- `min-width`, `min-height`
- `padding`, `margin`
- `background-color`, `color`, `border`, `border-radius`
- `font-size`, `font-weight`, `font-family`
- Standard box model properties

### Transparency Issues
- **Hyprland `ignore_alpha` rule forces transparency**
- Check `hyprland.conf` for `layerrule = match:namespace X, ignore_alpha 0.3`
- Remove or don't add `ignore_alpha` for windows needing solid backgrounds
- Use `rgb()` not `rgba()` for fully opaque colors

### Styling Not Applying
1. **CSS must be in `app.start({ css: ... })`** not external file
2. **GTK CSS selector must match:** Use `window.class-name` not `.class-name`
3. **Kill and restart AGS:** CSS only loads on startup
4. **Use GTK Inspector:** `ags inspect` to debug styles
5. **Check specificity:** `button.confirm` beats `button`

### Labels and Text
- **Never use plain text:** `<box>Text</box>` ❌
- **Always use label:** `<label label="Text" />` ✅
- **Button children:** Buttons need `<label />` children
- **Alignment:** Use `halign="center"` on labels, not boxes

### GTK Theme Warnings
Warnings like "Expected a valid color" are from system GTK themes and can be ignored. They don't affect AGS functionality.

## Testing & Debugging

```bash
# Test an AGS file directly
ags run ~/.config/ags/confirm-exit.tsx

# Check running instances
ags list

# Kill all AGS instances (apply CSS changes)
pkill gjs

# Monitor AGS output (filter warnings)
ags run ~/.config/ags/confirm-exit.tsx 2>&1 | grep -v "Gtk-WARNING"

# Launch GTK Inspector
ags inspect

# Check Hyprland layers
hyprctl layers -j | jq '.[] | select(.levels.overlay != null)'

# Reload Hyprland (apply layer rules)
hyprctl reload
```

## Best Practices

1. **Always prefer JSX over programmatic widget creation** - JSX is cleaner, more maintainable, and the recommended approach in AGS v3
2. **Use the `setup` callback to capture widget references** when you need imperative access
   ```tsx
   let myWidget: Gtk.Label | null = null;
   <label setup={(self: Gtk.Label) => { myWidget = self; }} />
   ```
3. **Avoid too many nested if statements in favor of early returns** for better code readability
4. **Always use inline CSS** in `app.start({ css: ... })` or `app.apply_css()` for components
5. **Set `namespace` prop** on windows for Hyprland layer rules
6. **Use enums not strings:** `Astal.Layer.OVERLAY` not `"overlay"`
7. **Avoid invalid GTK CSS properties** like `max-width` (use `min-width` or GTK properties)
8. **Kill `gjs` processes** to reload CSS changes: `pkill gjs`
9. **Test with GTK Inspector** (`ags inspect`) to debug styling
10. **Use `keymode={Astal.Keymode.EXCLUSIVE}`** for dialogs that need focus
11. **Check Hyprland layer rules** - avoid `ignore_alpha` for solid backgrounds

## Resources

- Official Docs: https://aylur.github.io/astal/guide/introduction
- GTK4 CSS: https://docs.gtk.org/gtk4/css-properties.html
- AGS GitHub: https://github.com/aylur/ags
