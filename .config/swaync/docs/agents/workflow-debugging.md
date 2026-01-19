# Workflow and Debugging

## Hot reload

```bash
swaync-client -rs  # Reload CSS
swaync-client -R   # Reload config.json
pkill swaync && swaync &  # Full restart
```

## GTK Inspector

```bash
GTK_DEBUG=interactive swaync
```

Inspector helps with:

- Widget tree inspection
- CSS class discovery
- Live rule testing
- Computed styles

## Testing notifications

```bash
notify-send "Test" "Message"
notify-send -a "APP_NAME" "Title" "Body" -A "Button1" -A "Button2" -t 0
notify-send -u critical "Critical" "This is critical!"
```
