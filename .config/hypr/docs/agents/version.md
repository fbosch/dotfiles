# Hyprland Version

Installed version last checked locally: Hyprland 0.55.0 (v0.55.0)

Reference baseline: Hyprland 0.55.0 release notes and Lua-first wiki pages.

- Commit: `ee58a513f77fa93d0b7e29ac9ad6e59554266711`
- Date: 2026-05-09
- Build: Nix (managed via Home Manager on NixOS)
- Platform: Linux only (NixOS)
- Libraries:
  - Aquamarine: 0.11.0
  - Hyprutils: 0.13.1
  - Hyprgraphics: 0.5.1
  - Hyprcursor: 0.1.13
  - Hyprlang: 0.6.8

0.55 reference notes:

- Lua config is the primary upstream documentation path. Hyprlang remains deprecated but still supported for a few releases.
- Removed options: `dwindle:pseudotile`, `decoration:shadow:ignore_window`, `render:cm_fs_passthrough`.
- `misc:vfr` moved to `debug:vfr` and should be treated as a debug-only setting.
- New config areas relevant to this repo: per-output `icc`, bind `auto_consuming`, device tags, `confine_pointer` window rules, scrolling layout consume/expel/wrapping, `scroll_move` gesture action, `rotatesplit` dwindle layout message, and glow decoration.
- Retest layer-shell input issues on 0.55 before carrying local workarounds; 0.55 includes input/layer focus changes.

Check version:

```bash
hyprctl version
```

See `docs/agents/references/Using-hyprctl.md` for additional `hyprctl` commands and flags.
