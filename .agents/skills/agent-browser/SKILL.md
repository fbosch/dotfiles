---
name: agent-browser
description: Browser automation through Pi's native browser tools backed by agent-browser and Lightpanda. Use for navigating pages, reading accessibility snapshots, clicking or filling controls, extracting rendered data, testing web apps, and bounded Jev-assisted action selection.
hidden: true
---

# Browser automation

Use Pi's native `browser_*` tools. The extension owns the machine-installed `agent-browser` CLI, session isolation, and Lightpanda engine selection.

## Start here

If the browser tools are inactive, call `search_tools` with a browser capability query. Do not invoke `agent-browser` through `bash` for normal browser work.

Choose the narrowest workflow that fits:

- Use `browser_run` for a bounded multi-step objective. Supply form contents through named `inputs`; mark credentials and other secrets as `sensitive`. Jev selects among explicit actions and values but never generates form contents.
- Use `browser_step` for one Jev-selected, navigation-only click.
- Use `browser_snapshot` and `browser_act` when the next action is deterministic or an unsupported interaction requires direct control.
- Use `browser_decide` for advisory selection among caller-supplied actions without execution.

Start a new session workflow with `browser_open`. Both orchestration tools take a fresh snapshot before every action and return the final snapshot. Keep their step limits small; inspect the returned stop reason and trace before continuing.

## Boundaries

- Keep credentials and secrets out of ordinary snapshots and Jev state. For `browser_run`, pass them only as inputs marked `sensitive`; their values are omitted from candidate descriptions and redacted from orchestration snapshots.
- Use current snapshot refs; do not reuse refs after the page changes.
- Prefer deterministic code and direct browser actions when the next step is obvious.
- Jev may select only candidates constructed by the extension. Never ask it to generate shell commands, selectors, or form values.
- Use direct CLI commands only to diagnose the native extension or access an unsupported advanced agent-browser feature. Load the installed CLI guidance with `agent-browser skills get core --full` before doing so.
- Lightpanda is optimized for automation but may not support every Chromium-specific site or API. Report incompatibility rather than silently switching engines.
