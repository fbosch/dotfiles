# Action and UX Standards

## Action ordering

1. Primary: toggle details, primary action
2. Secondary: open in browser/native app
3. Utility: copy actions
4. Management: refresh, settings, clear
5. Destructive: delete/remove

## Standard shortcuts

- `cmd+d`: toggle detail view
- `cmd+o`: open in browser
- `cmd+c`: copy primary identifier
- `cmd+shift+c`: copy alternate info
- `cmd+r`: refresh/reload
- `cmd+s`: save/apply
- `cmd+p`: open on platform
- `cmd+e`: reveal in parent directory
- `cmd+t`: open in terminal

Only attach shortcuts when the action is available.

## Toasts and window behavior

- For external URLs: show success toast + `closeMainWindow()`.
- For errors: use failure toast with `error.message` fallback.
- Do not trigger toasts during render; use `useEffect` or `onError` callbacks.

## Empty and loading states

- Use `List.EmptyView` for missing preferences or no results.
- Use `isLoading` on `List` / `Detail`.
