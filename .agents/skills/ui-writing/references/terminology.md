# Consequential Terminology

Use these distinctions only after inspecting the behavior. Project terminology wins when it is intentional and accurate; flag a conflict instead of silently renaming it.

## Remove and Delete

- **Use `Remove` when:** The item stops appearing in a collection, relationship, account, sidebar, or current context, while the underlying item or data remains available elsewhere.
- **Use `Delete` when:** The operation destroys the item or schedules its data for deletion according to the product's actual lifecycle.
- **Verify:** Whether data remains, moves to Trash or Recently Deleted, can be restored, is deleted remotely, or only loses an association.
- **Exception:** Preserve a platform or domain convention such as `Move to Trash` when it describes the actual intermediate state more precisely.
- **Related rules:** UI-01, UI-04, UI-07.

## Close and Quit

- **Use `Close` when:** The operation dismisses a window, document, panel, view, or session while the app or broader process continues.
- **Use `Quit` when:** The operation terminates the app on a platform where quitting is a user-visible app action.
- **Verify:** Whether background work, other windows, menu-bar presence, or the app process continues.
- **Exception:** A web sign-in session that ends is usually `Sign Out`, not `Quit`; a process-control interface may use domain-specific terms such as `Stop`.
- **Related rules:** UI-01, UI-04, CMP-02.

## Cancel, Done, and OK

- **Use `Cancel` when:** The control dismisses the current decision or task without applying the proposed action.
- **Use `Done` when:** The task is complete and the control confirms completion or dismisses the completed flow.
- **Use `OK` when:** A purely informational alert needs acknowledgment and no more specific action is being confirmed.
- **Verify:** Whether changes were already applied, are applied on dismissal, remain as a draft, or are discarded.
- **Exception:** Preserve an established platform convention when it accurately describes the flow. Do not replace `Cancel` merely because a more specific phrase sounds stylistically stronger.
- **Related rules:** UI-07, UI-08, CMP-04.

## Save and Apply

- **Use `Save` when:** The action persists a document, record, or explicit set of edits.
- **Use `Apply` when:** The action activates selected settings while the current window or task can remain open.
- **Verify:** Whether changes persist automatically, take effect immediately, close the interface, create a new artifact, or only affect a preview.
- **Exception:** If changes auto-save, a `Save` button may misrepresent the model; use a dismissal label or no action button as the component allows.
- **Related rules:** UI-01, UI-02, UI-03.

## Loading, Syncing, and Importing

- **Use `Loading` when:** The interface is retrieving or preparing content for display.
- **Use `Syncing` when:** The product is reconciling data between established sources or replicas.
- **Use `Importing` when:** The product is bringing external data into the product's own store or model.
- **Verify:** The operation's direction, whether local data changes, what counts as completion, and whether multiple phases exist.
- **Exception:** Use a broader verified status when the implementation does not expose the phase precisely. Do not guess `Syncing` from network activity alone.
- **Related rules:** UI-09, UI-10, UI-11.

## Clear and Reset

- **Use `Clear` when:** The operation removes current content, filters, history, or a value from the defined scope.
- **Use `Reset` when:** The operation restores a value or set of values to a known default or initial state.
- **Verify:** Which values change, whether user data is deleted, what the defaults are, and whether the operation is reversible.
- **Exception:** Preserve a familiar domain command when its behavior is established, such as clearing a search field without changing saved filters.
- **Related rules:** UI-01, UI-04, UI-07.
