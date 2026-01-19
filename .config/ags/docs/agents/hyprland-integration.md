# Hyprland Integration

## Layer rules

AGS windows need a `namespace` prop for Hyprland layer rules:

```tsx
<window
  name="my-window"
  namespace="ags-myapp" // Used in Hyprland layerrules
/>
```

In `hyprland.conf`:

```
layerrule = match:namespace ags-myapp, blur on
layerrule = match:namespace ags-myapp, no_anim on
# Don't add ignore_alpha if you want solid backgrounds.
```

Hyprland `ignore_alpha` forces transparency. Only add it if you want the layer to be transparent.
