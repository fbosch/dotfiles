# Keybindings and Actions

These conventions are based on common patterns in official Vicinae extensions.

## Primary actions

- Default (Enter/Return): primary action
- `Cmd+D`: toggle detail view
- `Cmd+S`: save/set/download and apply
- `Cmd+O`: open in external viewer/browser
- `Cmd+C`: copy primary identifier
- `Cmd+P`: open on platform
- `Cmd+T`: open in terminal
- `Cmd+E`: reveal in parent directory
- `Cmd+R`: refresh/reload

## Secondary actions (Cmd+Shift)

- `Cmd+Shift+C`: copy alternative info
- `Cmd+Shift+I`: copy detailed info
- `Cmd+Shift+S`: open in native app or advanced settings
- `Cmd+Shift+Delete`: clear cache/history

## Conditional keybindings

Only register shortcuts when the action is available:

```typescript
shortcut={
  showDetailsAction ? { modifiers: ["cmd"], key: "p" } : undefined
}
```

## Destructive actions

- `Ctrl+X`: delete
