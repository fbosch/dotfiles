# Debugging Tips

Check active windows:

```bash
hyprctl clients
```

Check layer surfaces:

```bash
hyprctl layers
```

Monitor in real-time:

```bash
hyprctl rollinglog -f
```

Get window properties:

```bash
hyprctl clients | rg -A10 "class: <class_name>"
```
