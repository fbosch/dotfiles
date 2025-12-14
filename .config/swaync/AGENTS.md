# SwayNC Configuration - Agent Guide

## Overview

SwayNC (Sway Notification Center) is a notification daemon for Wayland compositors using **GTK4's CSS engine**, NOT standard web browser CSS.

**Key Files:**
- `style.css` - Main stylesheet (GTK4 CSS)
- `config.json` - Configuration (widget layout, dimensions, behavior)
- `CSS_STYLING_GUIDE.md` - Comprehensive CSS reference (see this for detailed examples)

## 🚨 Critical CSS Limitations

### GTK4 CSS is NOT Web CSS

SwayNC uses GTK4's CSS parser which has **significant differences** from web CSS:

#### ❌ Does NOT Support

1. **Flexbox/Grid Layouts**
   ```css
   /* THESE DON'T WORK */
   display: flex;
   display: grid;
   justify-content: center;
   align-items: center;
   flex-direction: row;
   gap: 10px;  /* only in flexbox/grid context */
   ```
   - GTK uses its own widget layout system
   - Spacing must be done with `margin`/`padding`
   - Layout is controlled by widget hierarchy, not CSS

2. **Advanced Selectors**
   ```css
   /* NOT SUPPORTED */
   .parent:has(.child) { }
   .notification:is(.low, .normal) { }
   .notification:where(.critical) { }
   ```
   - Only basic selectors: `.class`, `#id`, `element`, `:hover`, `:active`, `:focus`, `>`

3. **Modern CSS Features**
   ```css
   /* LIMITED OR NO SUPPORT */
   container-type: inline-size;
   aspect-ratio: 16 / 9;
   width: 50%;  /* percentage sizing - unreliable */
   position: absolute;  /* GTK has different layout model */
   z-index: 999;  /* uses widget stacking order */
   ```

4. **Box Sizing**
   - `box-sizing: border-box;` - May not work as expected
   - GTK has its own box model

#### ✅ Does Support

1. **Basic CSS Properties**
   - Typography: `font-family`, `font-size`, `font-weight`, `line-height`, `text-transform`, `letter-spacing`
   - Colors: `color`, `background-color`, `border-color`, `opacity`
   - Box model: `margin`, `padding`, `border`, `border-radius`, `outline`
   - Sizing: `width`, `height`, `min-width`, `min-height`, `max-width`, `max-height`
   - Effects: `box-shadow`, `text-shadow`, `filter`
   - Transitions: `transition`, `animation`, `transform`

2. **CSS Variables** (with caveats)
   ```css
   :root {
     --bg-color: rgba(32, 32, 32, 0.85);
     --text-color: #ffffff;
   }
   
   .notification {
     background: var(--bg-color);
     color: var(--text-color);
   }
   ```
   - Work well but inheritance is limited
   - Test in context

3. **GTK-Specific Properties**
   ```css
   /* Icon styling */
   -gtk-icon-source: url("icon.svg");
   -gtk-icon-size: 24px;
   -gtk-icon-transform: scale(1.2);
   -gtk-icon-palette: success green, error red;
   -gtk-icon-shadow: 0 1px 2px rgba(0,0,0,0.2);
   
   /* DPI scaling */
   -gtk-dpi: 96;
   ```

4. **Modern Color Syntax**
   ```css
   /* All of these work in GTK4 */
   color: rgb(255, 0, 0);
   color: rgba(255, 0, 0, 0.5);
   color: hsl(120, 100%, 50%);
   color: hwb(120 30% 20%);
   color: oklab(0.5 0.1 0.1);
   color: oklch(0.5 0.2 180);
   color: color-mix(in srgb, red 50%, blue);
   ```

5. **GTK Widget Selectors**
   ```css
   /* These are GTK widget types, not standard CSS */
   box { }          /* GTK container widget */
   button { }       /* GTK button widget */
   label { }        /* GTK label widget */
   progressbar { }  /* GTK progress bar widget */
   scale { }        /* GTK scale (slider) widget */
   switch { }       /* GTK switch widget */
   scrollbar { }    /* GTK scrollbar widget */
   ```

## 📁 Widget Structure

Key CSS classes for targeting:

```
.notification                      # Main notification container
  .notification-default-action     # Clickable area
    .notification-content          # Content wrapper
      .app-name                    # Application name (header)
      .time                        # Timestamp
      .summary                     # Notification title
      .body                        # Notification body text
      .notification-action         # Action buttons (e.g., "Snooze", "Join Now")
  .close-button                    # Dismiss button

.control-center                    # Control center panel
  .widget-title                    # Widget headers
  .widget-dnd                      # Do Not Disturb widget
  .widget-volume                   # Volume widget
```

**State Classes:**
- `.notification.low` - Low urgency
- `.notification.normal` - Normal urgency
- `.notification.critical` - Critical urgency

## 🔧 Development Workflow

### Hot Reload (No Restart)

```bash
# Reload CSS only
swaync-client -rs

# Reload config.json only
swaync-client -R

# Full restart (if needed)
pkill swaync && swaync &
```

### Debug with GTK Inspector

```bash
# Launch with inspector
GTK_DEBUG=interactive swaync
```

This opens an interactive inspector to:
- View widget tree
- Inspect CSS classes in real-time
- Test CSS rules live
- See computed styles
- Debug layout issues

### Testing Notifications

```bash
# Simple notification
notify-send "Test" "Message"

# With action buttons
notify-send -a "APP_NAME" "Title" "Body" -A "Button1" -A "Button2" -t 0

# Test example
notify-send -a "CALENDAR" "Meeting Reminder" "Your meeting starts in 15 minutes." -A "Snooze" -A "Join Now" -t 0
```

## 🎨 Styling Best Practices

### 1. Button Sizing

**Problem:** GTK widgets don't respect `display: flex` or `width: fit-content` the same way as web CSS.

**Solution:** Use explicit sizing:
```css
.notification-action {
  /* Set explicit height and let width be automatic */
  width: auto;
  min-width: auto;
  height: 28px;
  padding: 0 12px;
  
  /* Prevent stretching */
  flex-shrink: 0;
  flex-grow: 0;
  
  /* Spacing between buttons */
  margin: 8px 6px 0 0;
}
```

### 2. Layout and Spacing

Since flexbox doesn't work, use traditional spacing:
```css
/* Use margins for spacing, not gap */
.notification-action {
  margin-right: 6px;  /* Space between buttons */
}

.notification-action:last-child {
  margin-right: 0;  /* Remove trailing space */
}
```

### 3. Colors and Transparency

GTK4 supports modern color syntax:
```css
/* Prefer rgba() for transparency */
background: rgba(32, 32, 32, 0.85);
border: 1px solid rgba(255, 255, 255, 0.1);

/* Or use CSS variables */
--bg-color: rgba(32, 32, 32, 0.85);
background: var(--bg-color);
```

### 4. Transitions and Animations

Work well but test which properties are animatable:
```css
.notification-action {
  transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
}

.notification-action:hover {
  background: rgba(55, 55, 55, 0.9);
  border-color: rgba(255, 255, 255, 0.2);
}

.notification-action:active {
  transform: scale(0.98);
}
```

## 🐛 Common Issues & Solutions

### Issue: Buttons too wide
**Cause:** GTK layout system stretching buttons to fill available space  
**Solution:** Use `width: auto`, `min-width: auto`, `flex-shrink: 0`, `flex-grow: 0`

### Issue: Spacing between elements not working
**Cause:** Using `gap` property (flexbox/grid only)  
**Solution:** Use `margin` or `padding` instead

### Issue: Percentage sizing unreliable
**Cause:** GTK has different sizing context than web CSS  
**Solution:** Use fixed pixel values or `auto`

### Issue: Selector not working
**Cause:** Using modern CSS selectors (`:has`, `:is`, `:where`)  
**Solution:** Use only basic selectors supported by GTK CSS

### Issue: CSS changes not applying
**Cause:** Need to reload or GTK theme override  
**Solution:** 
- Run `swaync-client -rs` to reload CSS
- Check `config.json` has `"cssPriority": "user"` to override GTK theme
- Use GTK Inspector to debug: `GTK_DEBUG=interactive swaync`

## 🔗 Resources

- **CSS Styling Guide:** See `CSS_STYLING_GUIDE.md` in this directory for comprehensive reference
- **Official Repo:** https://github.com/ErikReider/SwayNotificationCenter
- **Default Style:** https://github.com/ErikReider/SwayNotificationCenter/blob/main/data/style/style.scss
- **Community Examples:** https://github.com/ErikReider/SwayNotificationCenter/discussions/183
- **GTK4 CSS Reference:** https://docs.gtk.org/gtk4/css-overview.html

## ⚠️ Validation Checklist

Before committing style changes:

1. [ ] Test with `swaync-client -rs` (hot reload)
2. [ ] Send test notification: `notify-send -a "TEST" "Title" "Body" -A "Action1" -A "Action2" -t 0`
3. [ ] Verify no GTK-specific selectors are flagged as errors (they're valid for GTK, ignore linter)
4. [ ] Check that changes work in both floating notifications and control center
5. [ ] Test hover, active, and focus states
6. [ ] Verify colors and transparency render correctly

## 🚫 Git Commit Policy

**NEVER commit changes unless explicitly asked by the user.**

- Prepare changes and inform user they are ready to commit
- Only create commits when user explicitly requests it
