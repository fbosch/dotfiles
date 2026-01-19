# Validation Checklist

Before committing style changes:

1. Test `swaync-client -rs` (hot reload)
2. Send test notification: `notify-send -a "TEST" "Title" "Body" -A "Action1" -A "Action2" -t 0`
3. Verify GTK selectors are valid (ignore linter warnings for GTK selectors)
4. Check floating notifications and control center
5. Test hover, active, and focus states
6. Verify colors and transparency render correctly
