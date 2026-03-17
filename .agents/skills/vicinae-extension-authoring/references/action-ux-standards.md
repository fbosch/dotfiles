# Action and UX Standards

## Action ordering

1. Primary: toggle details, primary action
2. Secondary: open in browser/native app
3. Utility: copy actions
4. Management: refresh, settings, clear
5. Destructive: delete/remove

## Standard shortcuts

- Prefer `Keyboard.Shortcut.Common.*` first so user-customized keybindings are respected.
- Use only valid common keys: `Copy`, `CopyName`, `CopyPath`, `CopyDeeplink`, `Open`, `OpenWith`, `Refresh`, `Save`, `New`, `Edit`, `Duplicate`, `MoveUp`, `MoveDown`, `Pin`, `Remove`, `RemoveAll`.
- Use explicit `{ modifiers, key }` only when there is no matching common key (for example: Toggle Detail).
- For open/copy/run actions, prefer `Action.OpenInBrowser`, `Action.CopyToClipboard`, and `Action.RunInTerminal` wrappers before custom actions.

Only attach shortcuts when the action is available.

## Toasts and window behavior

- For external URLs: show success toast + `closeMainWindow()`.
- For errors: use failure toast with `error.message` fallback.
- Do not trigger toasts during render; use explicit action handlers or `onError` callbacks.

## Empty and loading states

- Use `List.EmptyView` for missing preferences or no results.
- Use `isLoading` on `List` / `Detail`.
