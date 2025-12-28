# Hyprland Configuration - Agent Guide

## 📦 Hyprland Version

**Current Version:** Hyprland 0.52.0 (v0.52.0)
- **Commit:** `6e09eb2e6cc1744687f158f2a576de844be59f4e`
- **Date:** 2025-12-15
- **Build:** Nix (managed via home-manager/nix-darwin)
- **Libraries:**
  - Aquamarine: 0.10.0
  - Hyprutils: 0.11.0
  - Hyprgraphics: 0.4.0
  - Hyprcursor: 0.1.13
  - Hyprlang: 0.6.7

**Check version:**
```bash
hyprctl version
```

## 🔧 Configuration Validation

**CRITICAL: Run after EVERY config change:**

```bash
hyprctl configerrors  # Check for parsing errors - MUST run after every edit
hyprctl reload        # Apply changes and validate (optional)
```

**Agent Protocol:**
- Run `hyprctl configerrors` immediately after modifying any `.conf` file
- If errors are found, fix them before proceeding
- Do NOT skip this step - invalid configs can break the compositor

## 📐 Layer Rules

Layer rules control how Wayland layer surfaces (waybar, notifications, overlays, etc.) interact with the compositor.

### Syntax

```hyprlang
layerrule = match:namespace <namespace>, <rule> [value]
```

### Common Rules

- `blur on/off` - Apply blur effect to layer
- `ignore_alpha <value>` - Ignore alpha values below threshold (0.0-1.0)
- `no_anim on/off` - Disable animations for layer
- `order <number>` - Set rendering order (higher = on top, negative = below)
- `animation <style> [params]` - Set animation style (e.g., `popin 90%`)

### Finding Layer Namespaces

```bash
hyprctl layers -j | jq -r '.[] | keys[] as $k | .[$k][] | "\(.namespace) - layer: \($k)"'
```

### Example: Fixing Layer Stacking Issues

When overlay layers block interaction with other layers:

1. **Check current layer order:**
   ```bash
   hyprctl layers | grep -A5 -B5 "layer_name"
   ```

2. **Add order rule to control z-index:**
   ```hyprlang
   layerrule = match:namespace layer_name, order -1
   ```

3. **Validate:**
   ```bash
   hyprctl configerrors
   hyprctl reload
   ```

### Layer Rules Location

All layer rules are defined in `hyprland.conf` around lines 196-221.

## 🎨 Configuration Structure

- `hyprland.conf` - Main config (sources other files)
- `animations.conf` - Animation settings
- `hyprbars.conf` - Title bar plugin config
- `hyprexpo.conf` - Workspace overview config
- `hyprlock.conf` - Screen lock settings
- `keybinds.conf` - Keyboard shortcuts
- `rules.conf` - Window rules
- `window-state.conf` - Window state management
- `workspaces.conf` - Workspace configuration
- `monitors.conf.example` - Monitor setup template (create `monitors.conf` for your setup)
- `hyprpaper.conf.example` - Wallpaper config template

## 🔍 Debugging Tips

**Check active windows:**
```bash
hyprctl clients
```

**Check layer surfaces:**
```bash
hyprctl layers
```

**Monitor in real-time:**
```bash
hyprctl rollinglog -f
```

**Get window properties:**
```bash
hyprctl clients | grep -A10 "class: <class_name>"
```

## 🚫 Common Pitfalls

1. **Invalid syntax errors:**
   - Always use `match:namespace <name>, <rule>` format
   - Rules like `ignore_alpha` use underscores (not `ignorealpha`)
   - Check `hyprctl configerrors` after any changes

2. **Layer stacking issues:**
   - Use `order` rule to control z-index
   - Lower/negative values render below, higher values on top
   - Default order is 0

3. **Scripts not executing:**
   - Ensure scripts in `scripts/` are executable: `chmod +x scripts/*.sh`
   - Scripts are referenced from config with full path: `~/.config/hypr/scripts/...`
