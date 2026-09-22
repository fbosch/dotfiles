---
name: agent-browser
description: Browser automation through Pi's native browser tools backed by agent-browser and Lightpanda. Use for navigating pages, reading accessibility snapshots, clicking or filling controls, extracting rendered data, testing web apps, and bounded Jev-assisted action selection.
hidden: true
---

# Browser automation

Use Pi's native `browser_*` tools. The extension owns the machine-installed `agent-browser` CLI, session isolation, and Lightpanda engine selection.

## Start here

If the browser tools are inactive, call `search_tools` with a browser capability query. Do not invoke `agent-browser` through `bash` for normal browser work.

Standard workflow:

1. Call `browser_open` with the URL.
2. Call `browser_snapshot`; prefer `interactiveOnly: true` and request URLs only when needed.
3. Use refs from that fresh snapshot with `browser_act`.
4. Snapshot again after navigation or any material page change.

Use `browser_decide` only when semantic judgment would improve action selection. Supply a concise objective, a bounded snapshot, and explicit candidate actions. Treat its result as advisory: inspect the returned probability and execute the selected action separately with `browser_act`. Never ask Jev to generate shell commands or arbitrary selectors.

## Boundaries

- Keep credentials and secrets out of snapshots and Jev state.
- Use current snapshot refs; do not reuse refs after the page changes.
- Prefer deterministic code and direct browser actions when the next step is obvious.
- Use direct CLI commands only to diagnose the native extension or access an unsupported advanced agent-browser feature. Load the installed CLI guidance with `agent-browser skills get core --full` before doing so.
- Lightpanda is optimized for automation but may not support every Chromium-specific site or API. Report incompatibility rather than silently switching engines.
