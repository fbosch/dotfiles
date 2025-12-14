# SwayNC CSS Styling Guide

Complete reference for styling SwayNC (Sway Notification Center) based on GTK4 CSS capabilities.

## Table of Contents
- [CSS Engine Overview](#css-engine-overview)
- [File Locations](#file-locations)
- [GTK4 CSS Capabilities](#gtk4-css-capabilities)
- [SwayNC Widget Structure](#swaync-widget-structure)
- [Supported CSS Properties](#supported-css-properties)
- [Limitations vs Web CSS](#limitations-vs-web-css)
- [Workflow & Tools](#workflow--tools)
- [Best Practices](#best-practices)
- [Examples](#examples)

---

## CSS Engine Overview

**SwayNC uses GTK4's CSS engine**, not standard web browser CSS.

- **Language**: Written in Vala
- **Dependencies**: gtk4, gtk4-layer-shell, libadwaita
- **Stylesheet Format**: CSS (preferably compiled from SCSS/Sass)
- **Parsing**: GTK's own CSS parser with custom extensions
- **Theme Compatibility**: Only officially tested with default Adwaita theme

### Key Differences from Web CSS
- Different box model behavior
- No flexbox/grid layout (GTK uses its own layout system)
- Limited selector support
- GTK-specific properties (e.g., `-gtk-icon-source`)
- Custom color syntax and functions

---

## File Locations

### System Default
```
/etc/xdg/swaync/style.css
/etc/xdg/swaync/config.json
```

### User Overrides (Recommended)
```
~/.config/swaync/style.css
~/.config/swaync/config.json
```

### Source Files
- [Default SCSS Template](https://github.com/ErikReider/SwayNotificationCenter/blob/main/data/style/style.scss)
- [Example Configurations](https://github.com/ErikReider/SwayNotificationCenter/discussions/183)

---

## GTK4 CSS Capabilities

### Colors

GTK4 supports modern CSS color syntax:

```css
/* RGB/RGBA */
color: rgb(255, 0, 0);
color: rgba(255, 0, 0, 0.5);

/* HSL/HSLA */
color: hsl(120, 100%, 50%);
color: hsla(120, 100%, 50%, 0.8);

/* HWB (Hue-Whiteness-Blackness) */
color: hwb(120 30% 20%);

/* Oklab/Oklch (Perceptual color spaces) */
color: oklab(0.5 0.1 0.1);
color: oklch(0.5 0.2 180);

/* color-mix() function */
color: color-mix(in srgb, red 50%, blue);

/* Relative colors */
color: rgb(from red r g 128);

/* Named colors */
color: white;
color: transparent;
```

### Custom Properties (CSS Variables)

```css
:root {
  --bg-color: #1e1e2e;
  --text-color: #cdd6f4;
  --accent-color: #89b4fa;
}

.notification {
  background-color: var(--bg-color);
  color: var(--text-color);
}
```

### Fonts

```css
.notification {
  font-family: "JetBrains Mono", monospace;
  font-size: 14px;
  font-style: italic;
  font-variant: small-caps;
  font-weight: 600;
  font-stretch: condensed;
  letter-spacing: 1px;
  line-height: 1.5;
}
```

### Box Model

```css
.notification {
  margin: 10px;
  padding: 15px 20px;
  border: 2px solid #89b4fa;
  border-radius: 12px;
  min-width: 400px;
  min-height: 100px;
}
```

### Backgrounds

```css
.notification {
  /* Solid color */
  background-color: #1e1e2e;
  
  /* Image */
  background-image: url("path/to/image.png");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  
  /* Linear gradient */
  background-image: linear-gradient(to bottom, #1e1e2e, #11111b);
  
  /* Radial gradient */
  background-image: radial-gradient(circle, #89b4fa, #1e1e2e);
}
```

### Shadows

```css
.notification {
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
}
```

### Transforms & Animations

```css
.notification {
  transform: scale(1.05) rotate(2deg);
  transition: all 200ms ease-in-out;
}

.notification:hover {
  transform: scale(1.1);
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.notification {
  animation: slide-in 300ms ease-out;
}
```

### GTK-Specific Properties

```css
.app-icon {
  /* GTK icon properties */
  -gtk-icon-source: -gtk-icontheme("mail-unread");
  -gtk-icon-size: 32px;
  -gtk-icon-transform: scale(1.2);
}

/* DPI scaling */
* {
  -gtk-dpi: 96;
}
```

### Media Queries

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-color: #1e1e2e;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}

@media (prefers-contrast: high) {
  .notification {
    border-width: 3px;
  }
}
```

---

## SwayNC Widget Structure

Complete CSS class hierarchy from the default style.scss:

```
.notification-window             # Main notification window
  .floating-notifications        # Container for floating notifications
    .notification-row            # Individual notification row
      .notification-background   # Background wrapper
        .notification            # Main notification container
          .notification-default-action  # Main clickable area
            .notification-content
              .app-icon          # Application icon
              .image             # Notification image/icon
              .text-box          # Text content container
                .summary         # Notification title
                .time            # Timestamp
                .body            # Notification body text
              progressbar        # Progress bar widget
              .body-image        # Body image
              .inline-reply      # Inline reply container
                .inline-reply-entry   # Text input
                .inline-reply-button  # Send button
          .notification-alt-actions  # Action buttons container
            .notification-action     # Individual action button
        .close-button            # Dismiss button

.blank-window                    # Blank window overlay

.control-center                  # Control center panel
  .control-center-list           # Notification list
    .control-center-list-placeholder  # Empty state
    .notification-group          # Grouped notifications
      .notification-group-headers
        .notification-group-icon
        .notification-group-header
      .notification-group-buttons
        .notification-group-close-button

.widget                          # Custom widgets (from config.json)
  .widget-dnd                    # Do Not Disturb widget
  .widget-label                  # Label widget
  .widget-mpris                  # Media player widget
  .widget-buttons                # Button widget
  .widget-volume                 # Volume widget
  .widget-backlight              # Brightness widget
```

### State Classes

Notifications have urgency levels:
```css
.notification.low      { }  /* Low urgency */
.notification.normal   { }  /* Normal urgency */
.notification.critical { }  /* Critical urgency */
```

Notification groups:
```css
.notification-group.collapsed { }  /* Collapsed group */
.notification-group.low       { }
.notification-group.normal    { }
.notification-group.critical  { }
```

---

## Supported CSS Properties

### Complete List

**Typography:**
- `font-family`, `font-size`, `font-style`, `font-variant`, `font-weight`, `font-stretch`
- `letter-spacing`, `line-height`, `text-decoration`, `text-shadow`, `text-transform`

**Colors:**
- `color`, `background-color`, `border-color`, `outline-color`, `caret-color`

**Box Model:**
- `margin`, `padding`, `border`, `border-radius`, `outline`, `outline-offset`
- `min-width`, `min-height`, `max-width`, `max-height`

**Backgrounds:**
- `background-color`, `background-image`, `background-size`, `background-position`
- `background-repeat`, `background-clip`, `background-origin`, `background-attachment`

**Effects:**
- `opacity`, `box-shadow`, `text-shadow`, `filter`

**Transforms & Animation:**
- `transform`, `transform-origin`, `transition`, `animation`

**GTK-Specific:**
- `-gtk-icon-source`, `-gtk-icon-size`, `-gtk-icon-transform`, `-gtk-dpi`
- `-gtk-icon-palette`, `-gtk-icon-style`, `-gtk-icon-shadow`

---

## Limitations vs Web CSS

### What DOESN'T Work

❌ **Flexbox/Grid Layout**
```css
/* These don't work in GTK */
display: flex;
display: grid;
justify-content: center;
align-items: center;
```

❌ **Advanced Selectors**
```css
/* Not supported */
.parent:has(.child) { }
.notification:is(.low, .normal) { }
.notification:where(.critical) { }
```

❌ **Modern CSS Features**
```css
/* Limited or no support */
container-type: inline-size;
aspect-ratio: 16 / 9;
gap: 10px;  /* (flexbox/grid gap)
```

❌ **Percentage-Based Sizing** (limited context support)
```css
/* May not work as expected */
width: 50%;
height: 100%;
```

❌ **z-index** (GTK uses widget stacking order)

❌ **Position** (absolute, fixed, sticky - GTK has different layout model)

### What Works with Caveats

⚠️ **calc()** - Limited support, test thoroughly
⚠️ **Custom properties** - Work well but limited inheritance
⚠️ **Transitions** - Work but some properties not animatable
⚠️ **Media queries** - Supported but limited query types

---

## Workflow & Tools

### Development Workflow

1. **Edit CSS file**
   ```bash
   nvim ~/.config/swaync/style.css
   ```

2. **Reload stylesheet** (no restart required)
   ```bash
   swaync-client -rs
   ```

3. **Reload config.json**
   ```bash
   swaync-client -R
   ```

4. **Restart daemon** (if needed)
   ```bash
   killall swaync
   swaync &
   ```

### GTK Inspector (Debug Tool)

Launch SwayNC with GTK Inspector:
```bash
GTK_DEBUG=interactive swaync
```

This opens an interactive inspector where you can:
- View the widget tree
- Inspect CSS classes in real-time
- Test CSS rules live
- See computed styles
- Debug layout issues

### SCSS Compilation

If using SCSS:
```bash
# Install sassc
sudo pacman -S sassc  # Arch
brew install sassc    # macOS

# Compile SCSS to CSS
sassc style.scss style.css

# Watch for changes
while inotifywait -e modify style.scss; do
  sassc style.scss style.css && swaync-client -rs
done
```

---

## Best Practices

### 1. Start with the Default Template

Download and modify the [official style.scss](https://github.com/ErikReider/SwayNotificationCenter/blob/main/data/style/style.scss) rather than starting from scratch.

### 2. Use CSS Variables

```css
:root {
  /* Define once, use everywhere */
  --bg-primary: #1e1e2e;
  --bg-secondary: #181825;
  --text-primary: #cdd6f4;
  --text-secondary: #bac2de;
  --accent: #89b4fa;
  --critical: #f38ba8;
  --border-radius: 12px;
  --padding: 15px;
}

.notification {
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: var(--border-radius);
  padding: var(--padding);
}
```

### 3. Test with Different Urgencies

```bash
# Test low urgency
notify-send -u low "Low" "This is a low priority notification"

# Test normal urgency
notify-send -u normal "Normal" "This is a normal notification"

# Test critical urgency
notify-send -u critical "Critical" "This is critical!"

# Test with actions
notify-send "Action Test" "Click me" -A "Accept" -A "Decline"

# Test with progress
for i in {0..100..10}; do
  notify-send "Progress" -h int:value:$i
  sleep 0.5
done
```

### 4. Organize Your Styles

```css
/* ==== Base Styles ==== */
* {
  all: unset;  /* Reset GTK defaults */
}

/* ==== Variables ==== */
:root { }

/* ==== Notification Window ==== */
.notification-window { }

/* ==== Floating Notifications ==== */
.floating-notifications { }

/* ==== Control Center ==== */
.control-center { }

/* ==== Widgets ==== */
.widget { }
```

### 5. Handle Theme Variants

```css
/* Support both light and dark color schemes */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1e1e2e;
    --text-primary: #cdd6f4;
  }
}

@media (prefers-color-scheme: light) {
  :root {
    --bg-primary: #eff1f5;
    --text-primary: #4c4f69;
  }
}
```

---

## Examples

### Minimal Clean Style

```css
* {
  all: unset;
}

.notification {
  background: rgba(30, 30, 46, 0.9);
  color: #cdd6f4;
  border: 1px solid rgba(137, 180, 250, 0.3);
  border-radius: 8px;
  padding: 12px;
  margin: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.notification.critical {
  border-color: #f38ba8;
  background: rgba(243, 139, 168, 0.1);
}

.summary {
  font-weight: 600;
  font-size: 14px;
}

.body {
  font-size: 12px;
  opacity: 0.9;
}

.close-button {
  background: transparent;
  color: #cdd6f4;
  border-radius: 4px;
  padding: 4px 8px;
}

.close-button:hover {
  background: rgba(243, 139, 168, 0.2);
}
```

### Catppuccin Mocha Theme

```css
:root {
  --ctp-base: #1e1e2e;
  --ctp-mantle: #181825;
  --ctp-crust: #11111b;
  --ctp-text: #cdd6f4;
  --ctp-subtext1: #bac2de;
  --ctp-blue: #89b4fa;
  --ctp-red: #f38ba8;
  --ctp-green: #a6e3a1;
}

.notification {
  background: var(--ctp-base);
  border: 2px solid var(--ctp-blue);
  border-radius: 12px;
  padding: 15px;
  margin: 10px;
}

.notification.critical {
  border-color: var(--ctp-red);
  background: linear-gradient(
    135deg,
    var(--ctp-base),
    color-mix(in srgb, var(--ctp-red) 10%, var(--ctp-base))
  );
}

.summary {
  color: var(--ctp-text);
  font-weight: 700;
}

.body {
  color: var(--ctp-subtext1);
}
```

### Glassmorphism Style

```css
.notification {
  background: rgba(30, 30, 46, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
```

### Animated Hover Effects

```css
.notification {
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.notification:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.4);
}

.notification-action {
  transition: background 150ms ease;
}

.notification-action:hover {
  background: rgba(137, 180, 250, 0.2);
}
```

---

## Resources

### Official Documentation
- [SwayNC GitHub](https://github.com/ErikReider/SwayNotificationCenter)
- [GTK4 CSS Reference](https://docs.gtk.org/gtk4/css-overview.html)
- [GTK4 CSS Properties](https://docs.gtk.org/gtk4/css-properties.html)

### Community
- [Configuration Examples (Discussion #183)](https://github.com/ErikReider/SwayNotificationCenter/discussions/183)
- [Default style.scss Template](https://github.com/ErikReider/SwayNotificationCenter/blob/main/data/style/style.scss)

### Tools
- [GTK Inspector Documentation](https://docs.gtk.org/gtk4/running.html#gtk-debug)
- [Sass/SCSS](https://sass-lang.com/)

---

## Troubleshooting

### CSS Not Applying
1. Check file location: `~/.config/swaync/style.css`
2. Reload stylesheet: `swaync-client -rs`
3. Check for syntax errors in terminal output
4. Verify class names with GTK Inspector

### Unexpected Behavior
1. Test with minimal CSS to isolate issue
2. Use GTK Inspector to see computed styles
3. Check for conflicting rules (specificity)
4. Verify GTK4 property support

### Performance Issues
1. Reduce shadow complexity
2. Limit animations
3. Optimize background images
4. Minimize use of transparency/blur

---

**Last Updated**: December 2025  
**SwayNC Version**: Latest (check GitHub for updates)  
**GTK Version**: GTK4
