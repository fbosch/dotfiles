# Pi integration feasibility

Checked against installed Pi `1.3.0` on 2026-10-22. The current runner remains active. The new directory has no extension entry point yet.

## Gate result

The inspected public APIs support the agreed architecture without a Pi patch. Four offline host probes pass with 34 assertions. They exercise real SDK sessions and selected installed extensions, using synthetic assistant-call records rather than provider requests. This clears host API selection for the first implementation slice, not production acceptance or cutover.

The probe is `.pi/agent/extensions/minimal-subagents/__tests__/host-feasibility.test.ts`. Run it against the installed SDK and TUI by setting `PI_SUBAGENT_TEST_SDK` and `PI_SUBAGENT_TEST_TUI` to their `dist/index.js` paths. Without these variables it uses the project's development dependencies, currently `0.99.1`. The installed-host probe used the `1.3.0` packages under `/nix/store/25bsx8r1i7fv5kj8b278x3nzbhmsfpyg-pi-1.3.0/lib/pi/node_modules/@earendil-works/`.

## Selective child resources

- `DefaultResourceLoader` supports `noExtensions` plus explicit `additionalExtensionPaths` and inline factories. Its implementation selects explicit paths when discovery is disabled (`dist/core/resource-loader.js:409`). Skills and project instructions have separate overrides. The SDK's `examples/sdk/04-skills.ts`, `06-extensions.ts`, `12-full-control.ts`, and `14-codemode-mcp.ts` demonstrate these public boundaries.
- The host probe loads the installed hashline extension plus local catastrophic-command guard, model presets, and OpenAI capability hooks through explicit paths. It invokes a real hashline read through native codemode and verifies anchored output. Native tool search is registered too. There is no network/model request in this check.
- Hashline `6.5.1` returns raw text from codemode by default. Its `src/read.ts` selects structured anchored rows only when `anchors: true` is supplied. The probe requests that flag; initial failures without it were fixture errors, not missing hashline registration.
- An explicit SDK tool allowlist filters ordinary extension tools, including later registrations. MCP tools are an exception: `dist/core/sdk.d.ts` documents that MCP registrations remain callable unless the list includes an `mcp__` entry or the denylist excludes them. The replacement must use an explicit MCP selection or deny `mcp__*` when none is selected. The probe verifies ordinary and MCP denials, late registration, and parent-only tool exclusion through actual nested dispatch.
- Nested execution passes through `tool_call` hooks. The probe verifies both an inline policy and the actual catastrophic-command guard. The latter uses a harmless replacement for `bash`, so the test cannot execute the destructive command string used to exercise the guard.
- The existing gotgenes parser copies `tools`, model, thinking, budgets, and related fields but does not parse the specialists' `permission` maps (`src/config/custom-agents.ts:59-75`). Those maps are not evidence of runtime filesystem/network enforcement. The replacement must not silently interpret unsupported permission declarations as enforced policy. Tool restrictions and selected mandatory policy extensions are enforceable; same-process extensions are not an OS sandbox.

Required implementation checks remain: reject missing files, skills, tools, and models; preserve project instructions; retain the resolved configuration; verify selected model routing and provider hooks during real child execution. The probes establish the host mechanisms, not every production bundle's contents.

## Native inspection

`docs/tui.md` documents `ctx.ui.custom(..., { overlay: true })`, `setWidget`, `confirm`, injected keybindings, event-driven `requestRender`, and public width helpers. `ScrollView` is publicly exported and supports `scrollTop`, `isFollowingEnd`, `scrollBy`, `scrollToEnd`, and layout updates.

The native scrolling probe verifies initial follow-end, a stable manually scrolled position as content grows, explicit follow resumption, and bounded text rendering at widths 12, 40, and 80. The SDK also publicly exports assistant/tool transcript components (`dist/index.d.ts:39`). No gotgenes UI implementation or private Pi UI patch is required.

The old runner owns `/subagents`; do not register the replacement command while that runner is active. Actual overlay focus, Enter/Escape navigation, cancellation dialogs, resizing, and visual acceptance still belong to implementation group 6. The probe is a component-level feasibility check, not an interactive acceptance test.

## Lifecycle and history

- `session_before_switch` can cancel new/resume operations. `AgentSessionRuntime` awaits the event and checks `cancel === true` before replacing the session (`dist/core/agent-session-runtime.js:78-88,128-151`). The extension must explicitly ask for confirmation and fail closed when confirmation is unavailable.
- Reload awaits `session_shutdown` with reason `reload`, invalidates the old runner, reloads resources, and rebuilds the runtime (`dist/core/agent-session.js:2970-3000`). There is no established cancellable pre-reload dialog hook. The agreed fallback is to disclose interrupted work during teardown.
- The host probe confirms awaited shutdown ordering and a process-scoped health marker surviving both resource reload and construction of another parent session. Use a uniquely named, versioned cell on the Node process object for cleanup health and uncertain-resource ownership. This uses normal same-process JavaScript state, not a private Pi API. Do not transfer healthy live workers into the replacement extension instance. Clear the health block only by process restart.
- `AgentSession.abort()` awaits `waitForIdle()`; `dispose()` is synchronous and cannot establish termination (`dist/core/agent-session.js:1943-1960,997-1015`). Await execution settlement and child shutdown handlers before disposal. Retain the reservation and process health block when confirmation fails. A bounded teardown-confirmation grace is separate from a worker execution deadline; no ordinary assignment gets a wall-clock limit. Non-cooperative tool behavior must be covered by lifecycle implementation tests before cutover.
- Direct child disposal does not emit `session_shutdown`. Explicitly dispatch that public lifecycle event and observe handler errors before releasing resources. The current runner's timeout-and-proceed helper is not a safe termination guarantee for the new contract.
- Persist worker reports and transcripts as non-context custom entries inside the parent session file using `appendEntry`. The supported session picker deletes that file through trash/unlink (`dist/modes/interactive/components/session-selector.js:552-583,704-719`), so embedded records follow parent retention/deletion. Separate worker sidecars would not get this guarantee. Use in-memory child session managers, and restore parent custom entries as read-only history.
- Foreground and wait cancellation can use their distinct tool-call abort signals. Question yielding can end a child execution segment and retain its session for a later prompt. Those scheduling semantics remain runner implementation work rather than new host APIs.

## Validation and remaining limits

- Installed-host probe: 4 passed, 0 failed, 34 assertions. No live parent reload, deletion, cancellation, or model call was performed.
- Earlier fixture failures identified a missing synthetic assistant-call record, empty bindings that did not trigger reload rebinding, an obsolete message setter, and hashline's codemode anchor flag. The final probe uses the current public state property and declared nested-call result type.
- Project typecheck exposed new-fixture mistakes, which were corrected, and unrelated diagnostics in installed `pi-hashline-edit-pro` source. Do not hide those diagnostics with casts, disabled strictness, or dependency edits. Record the final check results with the implementation handoff.
- The 0.99.1 development dependency versus 1.3.0 host mismatch is recorded, not silently upgraded. Run the focused probes against both when possible; request approval if a required API forces dependency changes.
- These checks do not establish production safety of arbitrary third-party extensions, visual acceptance, external-process shutdown, or runtime performance improvements. Those remain explicit implementation and acceptance checks.

## First implementation slice

`specialist.ts` now resolves explicit tools, bundles, selected skill files, model/thinking overrides, and assignment budgets. It retains an immutable configuration snapshot, rejects missing resources and unsupported permission maps, and checks a loaded child's tool set for missing or additional capabilities. The mandatory baseline cannot be omitted by the specialist. Production bundle membership and child-session wiring are not implemented yet; task 2.1 remains incomplete.

Validation after this slice:

- Project SDK tests: 12 passed, 0 failed, 73 assertions across the host probes and specialist tests. The host probes also passed separately against installed Pi 1.3.0: 4 tests, 34 assertions.
- `bun run typecheck`: exit 1, with nine diagnostics in installed `pi-hashline-edit-pro` source: `anchor-registry.ts:811`, `hashline/apply.ts:226`, `hashline/hash.ts:54,58,113`, and `hashline/resolve.ts:340,343`. The errors concern strict optional properties, possibly undefined values, and `findLast` library availability. No diagnostics were emitted for the new files.
- `devenv test`: timed out after 120 seconds; no successful aggregate result. Failures appeared in existing MCP, Fish, AGS/GJS, Neovim terminal, skill-evaluation, Stow, hashline/Delta, command lookup, skill-discovery, chart-runtime, and shell-runtime checks. Examples include unavailable fixture providers, sandbox read denials, missing model credentials, and a shell fixture waiting for `uwsm-app` entries. These failures were not repaired or bypassed. The captured output is `/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/pi-bash-a59402c81f88ce72.log` (temporary local artifact).
- Strict OpenSpec validation, prose checking, and tracked-diff whitespace checking passed. The new tests are covered by the existing `test:pi-extensions` path in `devenv.nix`; no separate dependency or workflow was added.

Runtime execution, scheduling, receipts, lifecycle implementation, interactive UI acceptance, and coordinated cutover remain pending. The current runner, specialist definitions, package manifests, and saved sessions are unchanged.
