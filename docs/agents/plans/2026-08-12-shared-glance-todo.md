# Shared Glance Todo

## Problem

Glance's built-in `to-do` widget stores tasks in each browser's localStorage.
The dashboard is available only on the trusted LAN, but users opening it in
different browsers or on different devices see separate lists.

Glance `v0.8.5` does not provide server-backed todo storage. Upstream PR #838
implemented it but was closed unmerged, so this change must not depend on a
custom Glance image or fork.

## Scope

- Replace the Home page's built-in `to-do` widget with one shared list.
- Store tasks durably on `rvn-srv` and synchronize open dashboards without
  polling.
- Keep the widget visually consistent with Glance's built-in todo UI.
- Permit every visitor to the trusted dashboard to create, edit, complete,
  delete, and reorder tasks.
- Start the shared list empty. Do not migrate existing browser-local tasks.

## Non-Goals

- Individual accounts, permissions, task ownership, or attribution.
- Public internet exposure or a standalone todo application UI.
- Maintaining an unmerged Glance fork.
- Importing the built-in widget's localStorage data.

## Design

Use a small NixOS-managed Bun service on `rvn-srv` as the single source of
truth. It stores one list in SQLite under `/var/lib/glance-shared-todo`.

```text
Glance browser
  |
  | https://glance.corvus-corax.synology.me/api/shared-todo/*
  v
Synology HTTPS reverse proxy (existing rule)
  |
  | http://192.168.1.46:8080
  v
Local nginx path router
  |                         |
  | /api/shared-todo/*      | all other paths
  v                         v
127.0.0.1:8091              127.0.0.1:8083
glance-shared-todo          Glance
  |
  v
SQLite database
```

The Glance page uses an `html` widget with an empty, data-marked root element.
`shared-todo.js` initializes it after Glance asynchronously replaces page
content, fetches the initial state, performs mutations, and subscribes to
Server-Sent Events for updates made by another browser. Use a `MutationObserver`
to handle Glance navigation and reinsertion, following the existing
`start-command-prompt.js` pattern.

Use Glance's existing todo class names and theme tokens where possible. Keep
only widget-specific rules in `shared-todo.css`; do not hardcode colours or
font sizes.

### API Contract

Prefix all endpoints with `/api/shared-todo`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/tasks` | Return the ordered task list and current revision. |
| `POST` | `/tasks` | Create a task. |
| `PATCH` | `/tasks/{id}` | Edit text or completion state. |
| `DELETE` | `/tasks/{id}` | Delete a task. |
| `PUT` | `/tasks/order` | Replace the ordered task IDs. |
| `GET` | `/events` | Stream task-list revisions as Server-Sent Events. |

Tasks contain a stable opaque ID, non-empty text, completion state, and an
integer order. Responses include a monotonically increasing list revision.
The server validates JSON content type, request shape, task existence, duplicate
IDs in reorder requests, and revision preconditions. A stale mutation returns
`409 Conflict`; the browser refetches state before retrying user input.

Every successful mutation runs in a SQLite transaction, advances the revision,
and publishes an SSE update. SSE is event-driven; it must not fall back to a
refresh interval.

### Network Boundary

Bind the service only to `127.0.0.1:8091`. Accept browser mutations only
when the `Origin` is exactly `https://glance.corvus-corax.synology.me`; reject
other supplied origins. This is cross-site request protection, not
authentication. The LAN remains the trust boundary, as agreed.

Keep the existing Synology proxy configuration:

```text
Host: glance.corvus-corax.synology.me
Destination: http://192.168.1.46:8080
```

Local nginx owns path routing and disables buffering for the SSE endpoint.

## Implementation

1. Add the shared todo service under
   `modules/services/containers/glance/` in `~/nixos`.
   - Implement the API in Bun with `Bun.serve` and `bun:sqlite`; add no npm
     dependencies.
   - Use a dynamically created system user, `StateDirectory`, a read-only
     packaged source path, and systemd filesystem hardening.
   - Create the database schema and indexes on startup.
   - Configure startup policy as a background NixOS service.
   - Default the listen address to `127.0.0.1` and port to `8091`.
   - Declare port `8091` through `services.exposedPorts` and document it in
     `docs/agents/service-ports.md`; do not open it in the firewall.

2. Add focused Bun tests next to the service source.
   - Test validation, CRUD, ordering, transaction atomicity, revision conflicts,
     and persistence after reopening SQLite.
   - Test rejected cross-origin mutation requests and accepted exact-origin
     requests.
   - Test that a mutation broadcasts one SSE revision notification.

3. Import `services/glance-shared-todo` in the `rvn-srv` host module.

4. Add `.config/glance/widgets/shared-todo.yml`.
   - Use an `html` widget titled `To-do` with a data-marked root container.
   - Replace `type: to-do` in `.config/glance/pages/home.yml` with the reusable
     widget include.

5. Add `.config/glance/assets/js/shared-todo.js`.
   - Render task controls with safe DOM APIs, never interpolated task text as
     HTML.
   - Support add, text edit, completion toggle, delete, and pointer/keyboard
     accessible reordering.
   - Apply optimistic UI only while preserving a recoverable prior state.
   - Reconcile after an SSE event or `409 Conflict` by refetching `/tasks`.
   - Show an in-widget error state for unavailable API or rejected mutations.
   - Ensure only one event stream and listener set are active per rendered root.

6. Add `.config/glance/assets/css/shared-todo.css`.
   - Reuse native todo styling patterns and Glance CSS variables.
   - Use container queries for responsive changes.

7. Reference the new JS and CSS from `.config/glance/glance.yml`.

8. Put local nginx on the existing LAN port `8080`, route the shared todo path
   to `127.0.0.1:8091`, and route all other paths to Glance on
   `127.0.0.1:8083`.

## Validation

1. Run the focused Bun test suite for the service.
2. Evaluate the `rvn-srv` NixOS configuration and confirm the port-conflict
   assertion succeeds.
3. Validate Glance YAML parses and inspect the deployed widget HTML.
4. Confirm direct service access is limited to the LAN address and mutations
   from another origin receive a rejection.
5. Through `https://glance.corvus-corax.synology.me`, open the dashboard in two
   independent browser profiles. Verify add, edit, complete, delete, and reorder
   operations appear immediately in both profiles.
6. Restart `glance-shared-todo.service` and verify the list persists.
7. Temporarily stop the service and verify the widget reports the unavailable
   state without losing its last confirmed UI state.

## Success Criteria

- All trusted dashboard visitors share one durable task list across browsers and
  devices.
- Task changes synchronize promptly through SSE with no polling loop.
- Concurrent edits fail explicitly rather than silently overwriting task data.
- The widget retains Glance's visual language and works at small and full column
  sizes.
- The API is available only through the trusted LAN and exact dashboard origin.
- Existing localStorage tasks are neither read nor modified.
