# Layer Rules

Layer rules control how Wayland layer surfaces (waybar, notifications, overlays, etc.) interact with the compositor.

## Syntax

```hyprlang
layerrule = match:namespace <namespace>, <rule> [value]
```

## Common Rules

- `blur on/off` - Apply blur effect to layer
- `ignore_alpha <value>` - Ignore alpha values below threshold (0.0-1.0)
- `no_anim on/off` - Disable animations for layer
- `order <number>` - Set rendering order (higher = on top, negative = below)
- `animation <style> [params]` - Set animation style (e.g., `popin 90%`)

## Finding Layer Namespaces

```bash
hyprctl layers -j | jq -r '.[] | keys[] as $k | .[$k][] | "\(.namespace) - layer: \($k)"'
```

## Example: Fixing Layer Stacking Issues

When overlay layers block interaction with other layers:

1. Check current layer order:

   ```bash
   hyprctl layers | rg -A5 -B5 "layer_name"
   ```

2. Add order rule to control z-index:

   ```hyprlang
   layerrule = match:namespace layer_name, order -1
   ```

3. Validate:

   ```bash
   hyprctl configerrors
   hyprctl reload
   ```

## Layer Rules Location

All layer rules are defined in `hyprland.conf` around lines 196-221.
