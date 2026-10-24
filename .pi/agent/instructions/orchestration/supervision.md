# Supervision and handoff

## Native tools and identities

- Launch with `subagent({ specialist, prompt, maxTurns, foreground: false })`. Fresh context is the default; `inheritContext: true` includes parent narrative text only. Follow native schemas even when a skill shows older argument names.
- Retain `workerId`, `assignmentId`, and acceptance criteria. Treat all returned identifiers as opaque strings. Copy them verbatim and compare each full value character-for-character with the original result before sending it; never abbreviate, normalize, reorder, or regenerate segments.
- Inspect with `subagent_result({ request: { mode: "status", workerId } })`; retrieve complete evidence with `mode: "report"`. An explicit wait uses `mode: "wait"`, both IDs, and optional `timeoutMs`. A background receipt is not a full report or verification. A wait timeout does not cancel the worker.
- Steer with `subagent_control({ request: { action: "steer", workerId, assignmentId, text } })`. Answer a pending question with `action: "reply"`, both IDs, its exact `questionId`, and `text`; do not use continuation to answer it.
- Continue an eligible stopped worker with `action: "continue"`, `workerId`, a bounded `prompt`, and explicit `maxTurns`. Continuation retains the resolved model and capabilities and accepts no model or thinking overrides. Cancel or release with the corresponding action and `workerId`. Cancellation is terminal; historical workers cannot continue. Cleanup uncertainty requires a Pi restart, not a reload.
- A failed lookup or resume does not authorize replacement. Check the supplied ID against the original result, correct transcription errors, and retry the same worker. "Not found" for a different string is a caller error, not evidence that the worker disappeared. If continuity is required and the original worker truly cannot be recovered, report the blocker rather than silently substituting another worker.

## Background supervision

- After launching, do independent work if available; otherwise return control to the user and resume on native updates or completion notifications. Do not immediately wait or repeatedly poll to keep the parent turn open. Use bounded status checks when supervision is needed.
- Use blocking waits only for explicitly synchronous workflows, such as timed benchmarks or a user-requested wait. Dependencies alone do not require blocking. Blocking calls delay queued user messages.
- Use native result, notification, and steering tools, not private session logs or unrelated coordination protocols. Worker-to-worker synchronization does not make the parent a participant. A protocol-specific observer or control tool requires an explicitly assigned parent role or a worker report establishing that action and its prerequisites; a tool name is not sufficient evidence.
- Require an update at the first material finding, before scope expansion, and when blocked. If a worker repeats discovery, broadens ownership, or cycles through unrelated failures, steer it to return a checkpoint.
- Require a completion or partial handoff with findings, changed files, actual checks and results, blockers, and the smallest next step. Ask workers to reserve their final turn for it.

## Recovery and integration

- At a turn limit, blocker, or interruption, inspect the result and partial diff before resuming or assigning another writer. Preserve observed partial evidence. Never blindly repeat the original broad prompt or launch a replacement into the same files.
- Bound each continuation to a newly authorized phase and turn budget. State which temporary restrictions it supersedes while preserving persistent safety and ownership constraints. After two unsuccessful bounded attempts at the same deliverable, stop and diagnose directly or ask the user.
- Continuations and correction requests retain the full output contract. Require checked values and source identifiers, not bare confirmation. Do not transcribe completed file contents into a continuation unless needed for the next phase.
- Integrate evidence from its original handoff. For diagnoses and reviews, retain the decisive expression or observed value with its file/line reference and explanation. Resolve conflicting later summaries against the original report rather than assuming the latest repetition is authoritative.
- Report material blockers and unverified partial work. The parent owns verification and integration; background execution or worker completion alone does not establish success.

## Checkpoint assessment

At a material finding, scope change, or blocker, the parent may call `assess_subagent_checkpoint` with the worker ID, original assignment and acceptance criteria, current scope, and recent progress. Do not call it for routine updates or polling. An unchanged sanitized checkpoint reuses its in-memory result.

- A material finding changes an assumption, solution, risk, or feasibility, such as a missing API capability or newly discovered shared state. Finding the expected file or passing an expected test is routine.
- A scope change crosses assigned files, ownership, deliverables, dependencies, or constraints. Assess before expanding; an implementation detail within the assignment does not qualify.
- A blocker prevents useful progress because a parent decision, permission, information, or dependency is unavailable. Conflicting criteria, missing credentials, or repeated failures without new evidence qualify; one failed test with an understood fix does not.

The tool returns classifier probabilities, confidence, and fixed advice, or an abstain/unavailable result. Verify this fallible advice against evidence and the assignment, then make any steering decision through `subagent_control`. The tool never steers, spawns, blocks, or cancels workers.

Payload bounds and best-effort redaction do not guarantee removal of secrets or sensitive data; do not include them. Cancellation or classifier unavailability is advisory only. Use parent judgment rather than retrying an unchanged checkpoint.
