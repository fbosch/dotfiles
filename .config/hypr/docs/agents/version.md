# Hyprland Version

Installed version last checked locally: Hyprland 0.56.0 (v0.56.0)

Reference baseline: Hyprland 0.56.0 release notes and Lua-first wiki pages.

- Commit: `8d50be06aa7d84283ac364a03df74bd834cab0ee`
- Date: 2026-08-20
- Build: Nix (managed via Home Manager on NixOS)
- Platform: Linux only (NixOS)
- Libraries:
  - Aquamarine: 0.14.0
  - Hyprutils: 0.14.0
  - Hyprgraphics: 0.5.1
  - Hyprcursor: 0.1.13
  - Hyprlang: 0.6.8

Compatibility notes:

- Lua is the active and primary configuration path. Hyprlang files are rollback
  material only.
- Inherited 0.55 removals: `dwindle:pseudotile`,
  `decoration:shadow:ignore_window`, and `render:cm_fs_passthrough`.
- `misc:vfr` moved to `debug:vfr` and remains a debug-only setting.
- 0.56 behavior relied on locally includes Lua mouse release follow-ups,
  `suppress_event` window rules, restored `changefloatingmode` events, and
  pending pre-map client fullscreen state.

Check version:

```bash
hyprctl version
```

See `docs/agents/references/Using-hyprctl.md` for additional `hyprctl` commands and flags.
