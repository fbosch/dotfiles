# AGS Configuration - Agent Guide

## Overview

AGS (Aylur's GTK Shell) configuration for Hyprland UI elements. Currently includes:
- `app.tsx` - Alt-Tab window switcher overlay
- `confirm-exit.tsx` - Exit confirmation dialog

**Important:** AGS no longer uses external CSS files. All styling is done inline via the `css` property in `app.start()`.

## AGS Command Reference

```bash
# Run an AGS app
ags run <file.tsx>

# List running AGS instances
ags list

# Quit an instance
ags quit <instance-name>

# Toggle window visibility
ags toggle <window-name>

# Generate TypeScript types
ags types

# Bundle an app
ags bundle <file.tsx>

# Launch GTK Inspector for debugging
ags inspect
```

## TSX/JSX Conventions

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

## Current Implementations

### app.tsx - Alt-Tab Overlay
- Watches `/tmp/hypr-tab-cycle.json` for changes
- Shows window list with current selection highlighted
- Auto-hides after 700ms
- Triggered by `~/.config/hypr/scripts/cycle-windows.sh`
- Uses external CSS from `style.css`

### confirm-exit.tsx - Exit Confirmation Dialog
- Shows confirmation dialog before exiting Hyprland
- Launches via `~/.config/hypr/scripts/confirm-exit.sh`
- Bound to `Super+M` in keybinds.conf
- **Key implementation details:**
  - **Uses programmatic GTK widget creation** instead of JSX for reliable layout
  - **Inline CSS** via `css:` property in `app.start()`
  - Creates all widgets using `new Gtk.Box()`, `new Gtk.Label()`, etc.
  - Uses proper GTK enums: `Gtk.Orientation.VERTICAL`, `Gtk.Align.CENTER`
  - Adds CSS classes via `.add_css_class()` method after widget creation
  - Appends children explicitly with `.append()` method
  - Window created directly in `main()`, not in separate function
  - Uses `namespace="ags-confirm"` for Hyprland layer rules
  - Uses `layer={Astal.Layer.OVERLAY}` (enum, not string `"overlay"`)
  - Escape key handler via `Gtk.EventControllerKey` added to window
  - Uses `keymode={Astal.Keymode.EXCLUSIVE}` to grab keyboard input
  - Button `onClicked` handlers connected via `.connect("clicked", callback)`
  - Must call `win.set_child(mainBox)` and optionally `win.show()` before returning
  - CSS must not contain invalid properties like `max-width`

## Common Issues

### Window Not Showing
1. **Check if running:** `ags list` or `ps aux | grep gjs`
2. **Check Hyprland layers:** `hyprctl layers -j | jq`
3. **Verify layer enum:** Use `Astal.Layer.OVERLAY` not `"overlay"`
4. **Check namespace:** Window needs `namespace` prop for layer rules
5. **Kill old instances:** `pkill gjs` before testing

### JSX vs Programmatic Widget Creation
**Issue:** JSX with lowercase tags like `<box>` and `<label>` may not properly create GTK widgets with correct layout properties, causing layout issues (e.g., vertical boxes rendering horizontally).

**Solutions:**
1. **Use programmatic GTK widget creation** when JSX fails:
   ```tsx
   // Instead of JSX:
   // <box orientation="vertical" spacing={8}>
   //   <label label="Text" />
   // </box>
   
   // Use explicit GTK constructors:
   const box = new Gtk.Box({
     orientation: Gtk.Orientation.VERTICAL,
     spacing: 8
   });
   const label = new Gtk.Label({ label: "Text" });
   box.append(label);
   ```

2. **Use proper GTK enums:**
   - `Gtk.Orientation.VERTICAL` / `Gtk.Orientation.HORIZONTAL`
   - `Gtk.Align.CENTER` / `Gtk.Align.START` / `Gtk.Align.END`
   
3. **Add CSS classes after construction:**
   ```tsx
   const widget = new Gtk.Button({ label: "Click" });
   widget.add_css_class("my-class");
   widget.add_css_class("another-class");
   // NOT: cssClasses: ["my-class"] in constructor
   ```

4. **Ensure window has a child and shows:**
   ```tsx
   win.set_child(mainBox);
   win.show();  // May be needed in some cases
   return win;
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

1. **Prefer programmatic GTK widget creation over JSX** for complex layouts to ensure proper rendering
2. **Use explicit GTK constructors** like `new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })`
3. **Add CSS classes with `.add_css_class()`** method, not `cssClasses: []` in constructor
4. **Always use inline CSS** in `app.start({ css: ... })` for single-file components
5. **Set `namespace` prop** on windows for Hyprland layer rules
6. **Use enums not strings:** `Astal.Layer.OVERLAY` not `"overlay"`
7. **Avoid invalid GTK CSS properties** like `max-width` (use `min-width` or GTK properties)
8. **Kill `gjs` processes** to reload CSS changes: `pkill gjs`
9. **Test with GTK Inspector** (`ags inspect`) to debug styling
10. **Use `keymode={Astal.Keymode.EXCLUSIVE}`** for dialogs that need focus
11. **Check Hyprland layer rules** - avoid `ignore_alpha` for solid backgrounds
12. **Call `win.set_child()` and `win.show()`** before returning window from main()

## Resources

- Official Docs: https://aylur.github.io/astal/guide/introduction
- GTK4 CSS: https://docs.gtk.org/gtk4/css-properties.html
- AGS GitHub: https://github.com/aylur/ags
