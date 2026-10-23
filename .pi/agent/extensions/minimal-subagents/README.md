# Minimal subagents

A local Pi runner for parent-owned, in-process specialist sessions. It keeps execution state, saved evidence, and live-session availability separate.

`index.ts` loads the local runner. Settings no longer register `@gotgenes/pi-subagents`; reload Pi to use the replacement in an existing thread. Do not enable both runners. See the [implementation audit](../../../../openspec/changes/pi-minimal-subagents/references/implementation-audit.md) for checks and remaining acceptance gaps.

## Files

| Files | Responsibility |
| --- | --- |
| `specialist.ts`, `catalog.ts`, `mcp.ts` | Resolve explicit capabilities and reject incomplete configurations |
| `child-session.ts`, `driver.ts` | Create isolated Pi sessions, run assignments, and confirm shutdown |
| `owner.ts`, `health.ts` | Own worker identities, queue capacity, budgets, and cleanup uncertainty |
| `history.ts`, `delivery.ts` | Save complete evidence and coordinate receipts with full-result waits |
| `parent-runtime.ts`, `tools.ts`, `host.ts` | Share launch/inspection/control behavior across parent integrations |
| `presentation.ts`, `overlay.ts`, `ui.ts` | Render progress and read-only inspection with confirmed cancellation |

## Specialist configuration

Definitions are Markdown files under the global agent directory's `agents/` folder. A trusted project's `.pi/agents/<name>.md` takes precedence. Untrusted project definitions do not override global specialists.

Required frontmatter fields are `description`, `model`, `max_turns`, `tools`, `bundles`, and `skills`. Empty bundle and skill lists must be explicit. The Markdown body is the role instruction. For example, this configuration uses the fixture model from the tests, not a production provider:

```yaml
---
description: Fixture specialist
model: fixture/model
max_turns: 12
tools: [read]
bundles: []
skills: []
---
Inspect the assigned evidence and report what you checked.
```

Production definitions must name an available model and the bundles backing their requested tools. Model and thinking overrides require separate permission in `allow_overrides: [model, thinking]`. A launch may supply a positive safe-integer `maxTurns`; otherwise it uses the specialist's required `max_turns`. The migrated definitions use 12/24-turn budgets and preserve lower limits. Only `general` permits model and thinking overrides.

`catalog.ts` defines the available bundles: `files`, `file-search`, `structural`, `git-read`, `web`, `browser`, `classifier`, `commands`, `charts`, `docs-mcp`, `github-mcp`, `chrome-mcp`, and `firefox-mcp`. Bundles select backing extensions and MCP servers; the `tools` list grants callable capabilities. `codemode` is shared by every specialist; include `tool_search` explicitly only when the role needs discovery.

Every child retains the central authentication, model, classifier, command-policy, and instruction baseline. Skills load only from the names explicitly selected for that specialist. Missing models, bundles, skills, extension files, MCP servers, or required callable tools fail preflight. Unexpected callable tools also fail preflight.

`permission` maps are rejected because this runner does not enforce that format. Extensions share the Pi process and are not an OS sandbox. Children cannot delegate. The parent owns workspace coordination; there are no automatic worktrees or runtime workspace locks.

## Parent tools

These are the active contracts, not aliases for the old runner's tools. Routed commands use `requestSubagentLaunch` over Pi's event bus and share the same `ParentRuntime` as tool calls.

Launch one specialist with `subagent`:

```json
{"specialist":"review","prompt":"Review the assigned changes; report findings and checks actually run."}
```

The default returns `kind: "launched"`, `workerId`, and `assignmentId`. Keep the returned IDs unchanged. Add `foreground: true` to await the report or a blocking question. Fresh context is the default; `inheritContext: true` adds quoted parent user/assistant text and compaction summaries, excluding tool results, images, and hidden reasoning. This is not a true session fork.

Inspect with `subagent_result`:

```json
{"request":{"mode":"status","workerId":"<worker-id>"}}
{"request":{"mode":"wait","workerId":"<worker-id>","assignmentId":"<assignment-id>","timeoutMs":30000}}
{"request":{"mode":"report","workerId":"<worker-id>"}}
{"request":{"mode":"transcript","workerId":"<worker-id>","offset":0,"limit":100}}
```

Omit `workerId` only for the status list. Status excludes report text, configuration prompts, and investigation transcripts. Report retrieval returns the complete report without a summarizer or arbitrary character cap. Transcript pages accept 1–500 entries and return `nextOffset` when more entries remain.

Background completion sends a structural receipt, not the report body. A foreground result or explicit wait returns available full evidence and consumes the concurrent completion notice. A timeout or interrupted background wait leaves its worker alive and preserves later notice delivery. A report is worker evidence, not a verified conclusion.

Control with `subagent_control`:

```json
{"request":{"action":"reply","workerId":"<worker-id>","assignmentId":"<assignment-id>","questionId":"<question-id>","text":"Use target A."}}
{"request":{"action":"steer","workerId":"<worker-id>","assignmentId":"<assignment-id>","text":"Focus on the shutdown path."}}
{"request":{"action":"extend-budget","workerId":"<worker-id>","assignmentId":"<assignment-id>","additionalTurns":2}}
{"request":{"action":"continue","workerId":"<worker-id>","prompt":"Check the next bounded case.","maxTurns":3}}
{"request":{"action":"cancel","workerId":"<worker-id>"}}
{"request":{"action":"release","workerId":"<worker-id>"}}
```

Replies require the current correlated question. Steering requires running work and the current assignment. Budget extension is for queued or question-waiting assignments. Continuation starts a new bounded assignment on an eligible idle session; it does not reload specialist configuration. Cancelled, released, historical, and cleanup-unknown workers cannot continue.

## Queue and lifecycle

Foreground work, background work, replies, and continuations share six execution slots. The seventh assignment waits. A question releases its slot only after the execution segment settles; its answer re-enters the queue with the remaining assignment budget. The driver warns with two turns remaining and enforces the hard ceiling. There is no ordinary assignment wall-clock deadline or automatic assignment replay.

A `stopping` result means cancellation was requested, not that execution ended. Capacity remains reserved until shutdown is confirmed. Uncertain cleanup retains ownership and blocks further delegation through a versioned process cell that survives extension reload. Restarting Pi ends the process; reopening saved history does not revive workers.

Interrupting a foreground wait cancels that worker. Interrupting the parent or a background wait does not cancel independent background work. Native provider retry is separate from replaying an assignment.

Session switch/fork confirmation does not tear workers down immediately: another hook may still decline the transition. Actual session shutdown awaits cancellation, release, and evidence writes. Reload has no cancellable confirmation hook; it tears workers down before loading the replacement runtime.

### Example coordination sequence

1. Launch two independent background assignments and retain each returned worker/assignment ID pair. They share the same queue; the parent remains responsible for disjoint write ownership.
2. If one returns a question, retain its `questionId` and inspect the other worker with `mode: "status"`. The waiting worker no longer occupies a slot once its execution segment has settled.
3. Answer with `action: "reply"` and all three IDs. The answer queues the same assignment with its remaining turns; it does not start a fresh budget.
4. Wait for the independent assignment and read its complete report. A wait timeout leaves it running; inspect again or wait later rather than relaunching it.
5. Launch dependent work only after checking the prerequisite evidence. For a new bounded task on an eligible retained worker, use `action: "continue"` with a new prompt and explicit budget when needed.

## Evidence and inspection

Worker records are custom entries in the parent session file, not model-context messages or separate worker archives. They follow parent-file retention. Failed writes leave available reports in memory and report storage failure separately from execution outcome. Fork-copied records do not grant the new parent control over the originating parent's workers.

`/subagents` opens the native overlay. Use arrows to select, Enter to inspect, and Escape to return to the list or close it. In a transcript, arrows and Page Up/Down scroll; Home/End move to its bounds. Tab selects labeled actions and Enter activates one. Manual upward scrolling pauses following; **Follow latest** resumes it. Returning to a worker preserves its scroll state within the open overlay.

Cancellation is available through labeled cancel-one and cancel-all actions, both with confirmation. There is no child chat editor or session takeover. Missing usage metrics display as unavailable. Execution failures, storage failures, and cleanup uncertainty remain distinct.

The background widget shows up to four worker rows by default, plus overflow and separate warnings. Questions precede running and queued work; launch order stays stable within each state. The host factory's `widgetRows` option changes the row limit. Foreground progress stays inline rather than duplicating its worker in the background widget. Rendering is event-driven, not polled.

The UI has component coverage but still needs real terminal focus, dialog, and visual acceptance. Do not treat these instructions as a completed cutover checklist.
