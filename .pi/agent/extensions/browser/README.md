# Browser workflows

The `browser_*` tools share classifier selection and safety checks across
agent-browser with Lightpanda, Chrome MCP, and Firefox MCP.

## Agent routing

The extension adds browser-first guidance to the session prompt before deferred
tools are activated. Use `tool_search` to load the required `browser_*` tools,
then use them for supported interactions on Chrome MCP and Firefox MCP as well
as agent-browser. Local guidance takes precedence over CLI-only browser skills.

Prefer `browser_run` for supported multi-step flows, even when individual steps
are obvious. It fills uniquely matched inputs deterministically and uses the
classifier for remaining choices. Use `browser_snapshot` and `browser_act` for
inspection, a single explicit action, or a step the workflow cannot express.
`browser_run` requires explicit input values and cannot derive new values from
page content.

Use raw MCP for unsupported operations such as page discovery, console or network
diagnostics, screenshots, arbitrary JavaScript, and dragging, or when the user
explicitly requests a native tool. State why raw MCP is needed. Native snapshots
may supply UIDs for those operations. Keep the same page and backend, and take a
fresh `browser_snapshot` before returning to browser actions after a page change.
Inspect workflow stop reasons before continuing. Do not use raw MCP to bypass
a failed or denied browser action, or a workflow confidence or authorization stop.

## Choose a backend

Run `/reload` after extension changes. If a `browser_*` tool is inactive, use Pi's native `tool_search` to discover and activate the specific tool. These tools use deferred exposure; `tool_load` does not activate them.

1. Call `browser_open` with a backend and URL.
2. Use the same backend for `browser_snapshot`, `browser_act`,
   `browser_step`, or `browser_run`.

For example, these are arguments to `browser_open` and then `browser_step`:

```json
{"backend":"chrome","url":"https://example.com"}
{"backend":"chrome","objective":"Read more about this example"}
```

Use `"firefox"` for Firefox MCP. Omitting `backend` selects the session-owned
agent-browser CLI with Lightpanda, even if the previous call used an MCP backend.

MCP operations use the last page opened on that backend in this Pi session.
Supply `pageId` to bind a call to an existing Chrome page or Firefox tab index.
An MCP server must already be configured in Pi's `mcp.json`.

## Actions and safety

- Use only refs from the latest snapshot on the same backend and page.
  MCP snapshots return common `@eN` aliases, not native UIDs.
- `browser_step` permits one classifier-selected navigation-only click.
- `browser_run` fills uniquely matched explicit inputs directly. The classifier
  chooses other candidates and separately authorizes button and link clicks.
- Mark secret inputs as `sensitive`. The workflow redacts their values from
  classifier state, returned snapshots, and action errors.
- `browser_act` performs the caller's explicit action without classifier checks.
- The run treats equal action labels and input names on one page as completed.
  Use explicit actions when distinct controls share a label and need the same action.

MCP calls go through `ctx.executeTool()`, including Pi's validation and permission
hooks. A failed call never causes a switch to another backend or a replayed click.
Native snapshots remain untrusted page content.

Chrome MCP does not support selector-scoped snapshots. Firefox selects the bound
tab before each operation and reads DOM metadata to distinguish input types.
Both adapters reject stale refs and refs whose page URL has changed.

## Files and checks

`index.ts` owns classifier policy and bounded workflows. `backends.ts` owns
browser execution, native snapshot normalization, and MCP ref binding.
`prompt.ts` owns browser-first session guidance.
Add adapter regression cases in the neighboring `__tests__` directory.

```sh
devenv test --option enterTest:string 'devenv tasks run test:pi-browser'
```

The scoped task runs browser tests and the Pi TypeScript check.

Live native MCP checks passed for opening, snapshots, filling, and clicking in
Chrome. Firefox passed snapshots and DOM metadata reads, and a separate native
chain passed opening, snapshots, filling, and clicking.

Firefox still loses created-tab bindings between chains in this environment.
A later `select_page` cannot find the index returned by `new_page`.
Cross-call Firefox validation remains blocked. Do not replay a failed action
automatically.
