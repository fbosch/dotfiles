# Debugging Tips

Check active windows (see `docs/agents/references/Using-hyprctl.md` for full output details):

```bash
hyprctl clients
```

Check layer surfaces (see `docs/agents/references/Window-Rules.md` for layer rule context):

```bash
hyprctl layers
```

Monitor in real-time (see `docs/agents/references/Using-hyprctl.md`):

```bash
hyprctl rollinglog -f
```

Get window properties (see `docs/agents/references/Using-hyprctl.md`):

```bash
hyprctl clients | rg -A10 "class: <class_name>"
```
