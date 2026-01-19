# Troubleshooting

## Common issues

Window not showing:

1. Check if running: `ags list` or `ps aux | rg gjs`
2. Check Hyprland layers: `hyprctl layers -j | jq`
3. Verify layer enum: use `Astal.Layer.OVERLAY` not "overlay"
4. Check namespace: window needs `namespace` prop for layer rules
5. Kill old instances: `pkill gjs` before testing

## GTK CSS property limitations

Invalid GTK CSS properties:

- `max-width` (use `min-width` or GTK properties)
- Web-specific properties like `display`, `flex`, `grid`

Valid GTK CSS properties:

- `min-width`, `min-height`
- `padding`, `margin`
- `background-color`, `color`, `border`, `border-radius`
- `font-size`, `font-weight`, `font-family`
- Standard box model properties

## Transparency issues

- Hyprland `ignore_alpha` forces transparency
- Check `hyprland.conf` for `layerrule = match:namespace X, ignore_alpha 0.3`
- Remove or avoid `ignore_alpha` for solid backgrounds
- Use `rgb()` not `rgba()` for fully opaque colors

## Styling not applying

1. CSS must be in `app.start({ css: ... })` or `app.apply_css()`
2. GTK CSS selector must match: use `window.class-name` not `.class-name`
3. Kill and restart AGS: CSS only loads on startup
4. Use GTK Inspector: `ags inspect`
5. Check specificity: `button.confirm` beats `button`

## Labels and text

- Never use plain text: `<box>Text</box>`
- Always use label: `<label label="Text" />`
- Button children need `<label />`
- Alignment: use `halign="center"` on labels, not boxes

## GTK theme warnings

Warnings like "Expected a valid color" come from system GTK themes and can be ignored.

## Testing and debugging

```bash
ags run ~/.config/ags/confirm-exit.tsx
ags list
pkill gjs
ags run ~/.config/ags/confirm-exit.tsx 2>&1 | rg -v "Gtk-WARNING"
ags inspect
hyprctl layers -j | jq '.[] | select(.levels.overlay != null)'
hyprctl reload
```
