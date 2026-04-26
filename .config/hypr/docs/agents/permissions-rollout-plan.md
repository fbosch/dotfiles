# Hyprland Permissions Rollout Plan

Plan for enabling Hyprland app permissions with minimal breakage.

## Goal

Enable:

```hyprlang
ecosystem {
    enforce_permissions = true
}
```

while preserving current screenshot, preview, picker, and screenshare workflows.

## Scope and Blast Radius

Primary affected permission is `screencopy` (default `ASK` when enforcement is on). This touches:

- `.config/hypr/scripts/window-capture-daemon.sh` (`grim -T` window previews)
- `.config/hypr/scripts/screenshot.sh` (`grimblast` workflows that call `grim`)
- `.config/hypr/keybinds.conf` screenshot/OCR binds that call screenshot scripts
- `hyprpicker -a` color picker bind in `.config/hypr/keybinds.conf`
- Portal-based screenshare via `xdg-desktop-portal-hyprland`

Plugin permission (`plugin`) should not be broadly allowed for `hyprctl`.

## Safety Constraints

- Permission changes require full Hyprland restart (reload is not enough).
- Validate config with `hyprctl configerrors` before restart.
- Keep rollback as a one-line toggle (`enforce_permissions = false`).

## Implementation Steps

1. Create dedicated permissions file:

   - `.config/hypr/permissions.conf`
   - Source it from `.config/hypr/hyprland.conf` in the current permissions section (keep load order unchanged).

2. Start with minimal allowlist in `permissions.conf`:

   ```hyprlang
   ecosystem {
       enforce_permissions = true
   }

   # Direct screenshot and preview capture
   permission = /nix/store/[a-z0-9]{32}-grim-[^/]*/bin/grim, screencopy, allow

   # Portal backend for browser/OBS/Discord-style screenshare
   permission = /nix/store/[a-z0-9]{32}-xdg-desktop-portal-hyprland-[^/]*/libexec/.xdg-desktop-portal-hyprland-wrapped, screencopy, allow

   # Start conservative for picker; switch to allow if prompts are noisy
   permission = /nix/store/[a-z0-9]{32}-hyprpicker-[^/]*/bin/hyprpicker, screencopy, ask
   ```

3. Keep plugin access strict:

   - Do not add broad `plugin, allow` rule for `hyprctl`.
   - Leave plugin default `ASK` unless explicit plugin workflow requires an allow rule.

4. Validate and apply:

   ```bash
   hyprctl configerrors
   ```

   Then restart Hyprland session.

## Validation Checklist (Post-Restart)

Run in this order:

1. Confirm enforcement active:

   ```bash
   hyprctl getoption ecosystem:enforce_permissions
   ```

2. Screenshot and OCR flows:

   - Trigger area screenshot bind
   - Trigger full-screen screenshot bind
   - Trigger OCR bind

3. Window preview capture:

   ```bash
   ~/.config/hypr/scripts/window-capture-daemon.sh refresh-once
   ```

   Verify preview images are generated and not black/empty.

4. Picker flow:

   ```bash
   hyprpicker -a
   ```

5. Portal screenshare:

   - Test in browser and one desktop app (for example OBS or Discord).

6. On failure, inspect logs:

   ```bash
   hyprctl rollinglog -f
   ```

## Rollback Plan

If any critical workflow fails:

1. Set in `permissions.conf`:

   ```hyprlang
   ecosystem {
       enforce_permissions = false
   }
   ```

2. Restart Hyprland session.
3. Re-test affected workflow.
4. Re-enable later with narrower scope (for example only `grim` first).

## Follow-Up Hardening

After one stable week:

- Consider switching `hyprpicker` from `ask` to `allow` if prompts add friction.
- Add explicit plugin rules only for concrete tools in use.
- Keep rules path-specific and avoid broad regexes where possible.

## References

- `docs/agents/references/Permissions.md`
- `docs/agents/references/Using-hyprctl.md`
- `docs/agents/pitfalls.md`
