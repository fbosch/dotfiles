# Best Practices

1. Prefer JSX over programmatic widget creation.
2. Use the `setup` callback to capture widget references when you need imperative access.
3. Set `namespace` on windows for Hyprland layer rules.
4. Use enums not strings: `Astal.Layer.OVERLAY` not "overlay".
5. Avoid invalid GTK CSS properties like `max-width` (use `min-width` or GTK properties).
6. Kill `gjs` to reload CSS changes: `pkill gjs`.
7. Use GTK Inspector (`ags inspect`) to debug styling.
8. Use `keymode={Astal.Keymode.EXCLUSIVE}` for dialogs that need focus.
9. Avoid `ignore_alpha` for solid backgrounds.
