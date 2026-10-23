# Implementation audit

Status: cutover configured at the user's explicit request; full acceptance remains incomplete. `index.ts` registers the replacement and settings no longer enable gotgenes. This existing thread requires `/reload` before using the new tools.

## Checked implementation

Source and neighboring tests are under `.pi/agent/extensions/minimal-subagents/`.

- `specialist.ts` and `catalog.ts` resolve explicit capabilities, skills, models, and budgets. Preflight rejects unsupported permission maps and unexpected callable tools. All 20 production specialist definitions now declare explicit capabilities and budgets.
- `child-session.ts` creates isolated Pi sessions. Tests exercise project instructions, scoped skill metadata, missing tools, partial startup, and selected native MCP registration.
- `context.ts` filters optional inherited context to user/assistant text and compaction summaries. The shared parent interface applies this filter; the native host supplies parent messages.
- `driver.ts` executes real Pi sessions with a fixture provider. Tests cover full reports, slash-command input as assignment text, hard turn limits, the two-turn warning, question/reply budget preservation, and shutdown-handler failure.
- `owner.ts` owns worker identities, the six-slot queue, correlated questions, continuation, cancellation, shutdown, and persistence outcomes. Its tests use a controlled driver rather than the production driver.
- `health.ts` keeps uncertain resource references and diagnostics in a versioned process cell. A replacement client sees the same blocked state.
- `history.ts` embeds worker evidence in parent custom entries. Tests restore complete reports and transcripts from a fixture parent file, reject malformed records, and preserve reports in memory after write failures. Restored running records cannot wait on a nonexistent execution.
- `delivery.ts` coordinates full-result waits and structural notices. Tests cover completion/wait races, interrupted background waits, foreground cancellation, question yielding, and storage-failure notices.
- `parent-runtime.ts` provides one launch/inspect/control interface with specialist preflight, optional narrative inheritance, shared queue admission, assignment correlation, and retained configuration. Tests exercise the real specialist resolver with a controlled driver.
- `tools.ts` defines the three parent tool adapters. Schema tests cover safe budgets, transcript bounds, and required correlation IDs. Native session registration and inspection/control dispatch now have installed-host tests; live launch dispatch still needs acceptance.
- `host.ts` connects native tool registration, session start/shutdown, switch/fork confirmation, parent persistence, and structural notices. Native tests cover registration, foreign-control rejection, full report restoration across reload, and fork-copied history remaining outside the new parent's control. `production.ts` connects the factory to the discovery entry point and routed launch event.
- `presentation.ts` renders attention-ordered worker rows, separate warnings, and detailed evidence. Seven tests cover the four-worker default plus overflow, terminal-space reduction, visible cleanup warnings, configurable limits, complete reports, unavailable metrics, cancellation eligibility, and terminal-control sanitization while preserving Danish letters. The native host now wires this rendering to the widget and overlay; terminal interaction acceptance remains pending.

- `overlay.ts` and `ui.ts` wire one `/subagents` overlay and an event-driven widget into the host factory. Component tests exercise Enter/Escape navigation, retained manual scroll position, follow-latest, cancel-one/cancel-all confirmation, visible stopping until shutdown confirms, and bounded frames. Foreground workers emit inline progress and remain outside the background widget while their wait is active. The tests drive component input directly; they do not establish real terminal focus, dialog stacking, or visual acceptance.
- Native lifecycle tests now cover declined/confirmed switches, deferred teardown, reload awaiting six active child shutdowns, queued cancellation, saved partial-evidence restoration, and cleanup uncertainty blocking delegation after reload. These tests inject controlled drivers and a fixture specialist; they do not make provider calls.
- `README.md` documents fields, capabilities, launch/result/control requests, queue/question sequences, continuation, cancellation, persistence, reload, and UI navigation. `readme.test.ts` resolves its specialist example through the production parser and validates all documented JSON requests against the registered tool schemas.
## Acceptance coverage and gaps

These are component results, not production acceptance. OpenSpec implementation tasks remain unchecked until their full verification criteria pass.

| Task group | Evidence | Missing acceptance |
| --- | --- | --- |
| 2. Launch one specialist | Specialist, context, child-session, driver, and production-bootstrap tests; live quick/general launches | Full role/provider/MCP acceptance beyond the bounded smoke checks |
| 3. Deliver evidence | History and delivery tests, complete long-report assertions | Live-worker persistence and receipt acceptance, registered launch acceptance |
| 4. Bounded parallel work | Owner queue/question tests, driver turn-limit tests | Multi-worker exercise using the real driver, capacity-bound foreground/reply scenarios, late-update host delivery |
| 5. Stop and continue | Owner lifecycle tests, real-driver shutdown-failure test, process-cell test, and native switch/reload tests with controlled child drivers | A combined multi-worker host lifecycle exercise with the production driver |
| 6. Native TUI | Presentation tests, six overlay component tests, foreground progress/visibility test, and native host wiring | Actual terminal focus and dialog behavior, representative-size visual checks, configurable keybinding review |
| 7. Cutover | Migrated consumers and settings; installed SDK single-runner registration | Reload this thread, remove inactive old source, broad validation, comparable measurements, rollback exercise |

## Validation for this increment

`cd .pi/agent && bun test extensions/minimal-subagents/__tests__/` now passes with **85 tests and 415 assertions across 16 files**.

The native host tests also passed against installed Pi 1.3.0 using `PI_SUBAGENT_TEST_SDK=/nix/store/25bsx8r1i7fv5kj8b278x3nzbhmsfpyg-pi-1.3.0/lib/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js`: **6 tests, 46 assertions**. The real-driver fixture suite also passed on installed Pi 1.3.0 with **5 tests and 27 assertions**, including a tool that deliberately ignores cancellation. The added lifecycle cases use real Pi session hooks and controlled child drivers. The non-cooperative-tool case uses the production driver and real Pi child sessions with an offline fixture provider. Live external-provider measurements and the combined multi-worker acceptance exercise remain pending.

The earlier hashline/provider probe exceeded its 5000 ms timeout twice. A diagnostic run located the variable delay in extension binding. Source inspection showed that hashline uses its own state directory, independent of the SDK fixture's `agentDir`; startup reads the store and scans session sidecars there. A new assertion first failed because the fixture had no local hash store. The fixture now sets the supported `PI_HASHLINE_DIR` override and restores it after teardown. The assertion passes, and three isolated runs completed in 217.41, 211.86, and 217.21 ms without changing the timeout. Temporary diagnostics were removed. These are fixture timings, not a production speedup.

The complete installed Pi 1.3.0 feasibility suite also passes with **4 tests and 35 assertions**, using both `PI_SUBAGENT_TEST_SDK` and `PI_SUBAGENT_TEST_TUI` overrides. Broad typecheck and project-workflow gaps below remain unresolved.

`openspec validate pi-minimal-subagents --strict` and `git diff --check` passed before this audit was written. Neither check proves runtime acceptance.

`cd .pi/agent && bun run typecheck` exited 1 with nine diagnostics in installed `pi-hashline-edit-pro` source:

- `src/anchor-registry.ts:811`: optional boolean properties conflict with `exactOptionalPropertyTypes`.
- `src/hashline/apply.ts:226`: optional properties include explicit `undefined`.
- `src/hashline/hash.ts:54,58,113`: possibly undefined accesses and optional-property mismatch.
- `src/hashline/resolve.ts:340,343`: `findLast` is missing from the configured library target, with resulting implicit-parameter diagnostics.

No diagnostics named the new modules. The project typecheck still fails; no installed dependency was edited.

Dekit discovered and inspected `devenv:test:pi-extensions`, but starting it returned `Error: Dekit registration failed for devenv:test:pi-extensions:` without further diagnostics. This attempt did not run the project test task. The earlier broad `devenv test` timeout and unrelated failures remain unresolved.

A direct `devenv tasks run test:pi-extensions` attempt reached the project tests but timed out after 120 seconds. Observed failures outside this change included `extensions/skill-discovery/__tests__/mid-task-runtime.test.ts` reporting an unknown `mid-task-fixture` provider and sandbox read denials, plus chart runtime tests reporting no model API key and a saved-chart startup failure. The full run did not produce a final pass/fail total. Its output is `/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/pi-bash-6542445db961a43d.log`. Sandbox grants, credentials, and installed dependencies were not changed. These failures block production acceptance and need a separate scope decision before repair.

The new non-cooperative-tool test confirms that abort timeout retains resources, leaves the worker `cleanup-unknown`, rejects further launches, and does not silently clear the block when the tool later returns. Its cleanup releases only the test's controlled wait and closes the fixture session.
No performance, token, or footprint improvement is claimed. The requested configuration cutover does not complete the remaining acceptance criteria.

## User-requested cutover

The user requested switching runners despite the remaining broad-suite failures. Settings now omit the old package registration and disable its steering renderer. The installed package, old inactive UI source, and old runner configuration remain on disk; no generated dependency state or existing saved sessions were removed. Prompt UI no longer installs the old widget or transcript-link hooks.

Production bootstrap exposes one event-based launch path shared with the parent tools. Routed prompts await preflight errors instead of calling the old global service. Mentions and orchestration instructions use the new schemas. All 20 specialists declare explicit tools, bundles, skills, and budgets. Unsupported permission maps are removed. Read-only review retains a fixed-argument Git diff tool rather than gaining a shell. Obsolete lens identifiers are replaced with current installed tool names.

- Focused checks: **111 pass, 0 fail, 588 assertions across 21 files**. Log: `/tmp/pi-minimal-cutover-tests.log`.
- Installed Pi 1.3.0 host/driver/production checks: **15 pass, 0 fail, 181 assertions**. Log: `/tmp/pi-minimal-cutover-installed-tests.log`.
- Installed SDK discovery: no loader errors; exactly `subagent`, `subagent_result`, and `subagent_control`, all from the new `index.ts`. Log: `/tmp/pi-minimal-cutover-registration-installed.log`. Development SDK discovery failed on the unrelated `pi-codemode-compact` renderer API absent in SDK 0.99.1.
- Live Pi 1.3.0 child probes: `quick` and `general` returned `RUNNER_OK` in one turn using their configured presets. The RPC probes exited 0. The earlier print probe completed its child but exited 1 when parent startup collided with an injected storage-failure turn. These checks are not comparable performance measurements.
- Startup-only probes exposed a persistence limitation: Pi does not create a new parent file before its first user/assistant message. Worker evidence then reports storage failure. A probe against a temporary parent with a seeded user message avoids that initial-file condition. This remains part of pending persistence acceptance, not a claimed fix.
- Typecheck still exits 1 with the same nine diagnostics in installed `pi-hashline-edit-pro`; none names the changed implementation. Log: `/tmp/pi-minimal-cutover-typecheck.log`.

Before cutover, the project task with a temporary `pi --no-sandbox` wrapper completed with **2242 pass, 61 fail, 6 skip, 1 error**. Sandbox/provider startup failures disappeared, but output-stream assertions, package patch/tool-registration checks, PATH-sensitive tests, and missing `fc-match` remained. Log: `/tmp/pi-unsandboxed-validation.YheJom/workflow.log`.

The bootstrap worker ended with an abort before handoff. Its partial files were inspected and checked by the parent before integration. No replacement writer was launched.

Rollback must disable the local entry point and re-enable the old package registration together, then restore only the affected consumer/configuration hunks and reload. Do not reset the worktree, enable both runners, or rewrite saved sessions. The rollback procedure has not been exercised.

Post-cutover project task: `devenv tasks run test:pi-extensions` with the same unsandboxed Pi wrapper exited 1 after 207.76 seconds of tests: **2247 pass, 61 fail, 6 skip, 1 error across 239 files**. Comparing normalized failing test names with the pre-cutover run found no added or removed failures. The typecheck stage was not reached; its separate result remains the nine dependency diagnostics above. Log: `/tmp/pi-minimal-cutover-workflow.log`. Strict OpenSpec validation, prose checks, and `git diff --check` passed.
