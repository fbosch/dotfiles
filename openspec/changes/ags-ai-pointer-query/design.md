## Context

See `proposal.md` for motivation and the two capability specs for behavior. AGS currently has a synchronous Hyprland IPC client, a cursor-monitor helper, bundled component routing, and XState controllers for temporal UI behavior. It has no AI request client. OpenCode SDK use currently exists in AI Commit, but that workflow is intentionally not an integration point for this change.

Hyprland exposes client, layer, monitor, active-window, cursor, and lock snapshots through its IPC query socket. Its existing `grimblast area` wrapper owns selection internally and returns only a captured path, so AGS owns pointer-path sampling and derives the final capture geometry before calling `grim`.

## Goals / Non-Goals

**Goals:**

- Keep pointer selection, capture, presentation, and cancellation in one AGS feature slice.
- Keep backend, SDK, server, session, policy, and response-shape knowledge behind one Bun runtime boundary.
- Send the smallest selected image and compositor metadata needed to explain the selection.
- Make the model request read-only by construction and preserve cancellation/resource ownership across AGS and Bun process boundaries.
- Preserve a stable backend-neutral machine protocol that future local answer workflows can use without inheriting pointer UI or OpenCode concepts.

**Non-Goals:**

- Extracting, sharing code with, or changing AI Commit.
- Building a generic multi-provider framework, conversation store, or desktop automation layer.
- Treating a rectangle overlap as a compositor hit test, visible-pixel calculation, or z-order assertion.
- Sending `/proc` command lines, process working directories, clipboard contents, OCR output, accessibility trees, or semantic application content to the answer runtime.
- Capturing ambient screen data, listening for voice, or retaining sessions for follow-up conversation.

## Decisions

### A backend-neutral Bun boundary isolates inference from AGS

The answer runtime lives under `.config/opencode/libexec/answer-request/` and has a library API plus a JSON stdin/stdout CLI. AGS invokes the CLI through `Gio.Subprocess` with argv arrays; it never imports Node or Bun SDK code and never names OpenCode, an agent, a model, tools, a configuration directory, an endpoint, or a session.

The protocol owns validation, verified attachment loading, backend invocation, cancellation, final-text normalization, and machine-safe errors. The caller owns prompt wording, selection, capture, rendering, and retry UX. Its request contains only a request ID, the fixed `answer` operation, prompt text, attachment descriptors, and timeout.

Inside the runtime, one deep `AnswerBackend.execute()` interface accepts validated prompt and attachment bytes and returns final answer parts or stable backend failures. The OpenCode implementation owns agent, model, tool policy, connection, server ownership, session lifecycle, and cleanup. Runtime composition selects that trusted implementation locally; untrusted request fields cannot select or configure a backend. Replacing OpenCode later means implementing the same backend interface while preserving the caller protocol and AGS workflow.

Alternative considered: make an AGS service call OpenCode directly. Rejected because GJS and Bun have separate dependency and lifecycle models, and it would spread SDK compatibility/cancellation details into the desktop process.

Alternative considered: reuse AI Commit's generator. Rejected because it owns commit prompts, parsing, server UI, and terminal behavior. The request runtime is introduced alongside it; AI Commit remains unchanged.

### Protocol version 2 streams closed, bounded, backend-neutral events

The CLI accepts one protocol-version-2 JSON request with a run ID, fixed `answer` operation, prompt text, attachment descriptors, and timeout. It emits newline-delimited JSON records with the same run ID: one `start`, bounded append-only `delta` records, and exactly one terminal `final` or `error`. Invalid input emits only an `error` with a nullable run ID. Sequence numbers are contiguous, records and aggregate output are bounded, and a terminal record is followed only by process completion. Zod validates input and Bun-side output boundaries. The runtime never writes backend logs, raw SDK events, reasoning, tool parts, provider objects, or unframed output to stdout.

The Bun adapter consumes OpenCode SSE internally through `event.subscribe`, starts generation through `session.promptAsync`, and correlates the ephemeral session, assistant message, and text part before forwarding deltas. It disables SSE reconnects because OpenCode does not expose resumable event IDs. A matching idle event triggers retrieval and validation of the completed assistant message. The terminal `final` record contains the authoritative normalized answer and is emitted only after session and owned-server cleanup succeeds. A terminal failure clears provisional text in AGS.

AGS parses stdout incrementally as bytes, enforces per-record and aggregate limits before decoding strict UTF-8, and accepts progress only for the current immutable run ID and contiguous sequence. Partial output is presentation state within `requesting`; it does not create a machine state or count as completion. Cancellation, lock, malformed output, unsuccessful process exit, or a terminal error clears provisional text.

The initial OpenCode backend uses the fixed OpenCode configuration directory and fixed `desktop-pointer` agent. It does not derive the backend, directory, agent, tools, server URL, or model from the focused window, selected text, image, caller payload, or user prompt. The component-owned agent prompt defines the answer policy and distinguishes the XML-escaped user question from untrusted screenshot and compositor metadata.

OpenCode 1.18.21 uses a truthy custom agent prompt instead of its model-family provider prompt, then appends OpenCode environment and configured project instructions. The `desktop-pointer` agent loads its complete answer-only system prompt from `.config/ags/components/ai-pointer/desktop-pointer-prompt.txt`, keeping the feature's model behavior reviewable beside the component. OpenCode's remaining harness context cannot be disabled through the 1.18.21 SDK.

The read-only web policy combines the `desktop-pointer` agent's deny-by-default tool configuration with explicit access to built-in web search/fetch and the dedicated `ai_pointer_exa_web_search_exa` MCP tool. The request-time map independently disables every enumerated tool except those exact identifiers. If the runtime cannot enumerate tools or resolve the requested agent, it fails before transmitting user content.

Alternative considered: pass a caller-defined tool map. Rejected because it makes the desktop capture boundary an authority boundary and is not required for read-only Q&A.

Alternative considered: expose agent and model fields in the versioned protocol. Rejected because those fields leak the initial backend into every caller and force an AGS migration when the backend changes.

Alternative considered: forward SSE to AGS or use SSE framing over stdout. Rejected because SSE retry, event-ID, comment, and field-folding semantics belong at the OpenCode HTTP boundary, not a strict local subprocess protocol.

Alternative considered: add a streaming toolkit. Rejected because the installed SDK already parses SSE, while native JSON, UTF-8 encoders, and Gio byte streams provide the bounded NDJSON subprocess framing without another dependency.

### Semver-bounded SDK and owned-server fallback contain compatibility drift

The libexec Bun package uses the compatible `@opencode-ai/sdk` range `^1.18.21`. The runtime applies the same range to stable OpenCode CLI and server versions, allowing compatible `1.x` updates while rejecting older releases, prereleases, and `2.x`. The helper is launched with `bun run --no-install`, preventing first-use package mutation or registry access.

The verified 1.18.21 baseline uses the SDK's v2 client. It provides `global.health`, `app.agents`, `tool.ids`, image `FilePartInput` values accepted by `session.prompt`, request-time tool maps, `session.abort`, and `session.delete`. The configured default model, `openai/gpt-5.6-terra-fast`, reports attachment and image-input support. Before reading or transmitting attachment bytes, the runtime resolves the effective configured model and fails safely when the model is absent, inactive, or does not positively declare image-input support; the versioned protocol defines the stable failure code separately.

The runtime probes only the fixed loopback endpoint already used for local OpenCode service reuse. It requires a bounded health response, validated version compatibility, and successful agent/tool-policy verification before attaching user data. If the endpoint is absent or unsuitable, it starts an SDK-owned ephemeral server. Ownership is represented explicitly so only the owned branch can close a server.

External server reuse is a latency optimization, not an authentication mechanism against software running as the same local user. The runtime does not scan ports, accept remote URLs, restart an external server, or terminate one.

Alternative considered: always start a server. Rejected because it adds startup latency and duplicate server processes to every pointer request.

Alternative considered: use a reachable server without verification. Rejected because a stale server can have an incompatible SDK/API, missing agent, broader configuration, or another provider account.

### Every request has an ephemeral, independently cleaned lifecycle

Each request creates one session. On normal completion it deletes that session. On timeout, cancellation, SIGINT, or SIGTERM it attempts `session.abort`, then `session.delete`, then closes an owned server. Each operation gets a fresh, bounded signal; an expired prompt signal must not prevent cleanup. Cleanup is idempotent and reports `cleanup_failed` when a local session cannot be removed.

AGS first requests cooperative helper termination and gives it a short grace period to run this cleanup. Only then may it force-exit the helper. A forced helper exit cannot guarantee provider-side cancellation, so the UI never claims that remote/provider data was deleted.

Alternative considered: terminate Bun immediately on Escape. Rejected because it can orphan an active OpenCode request, session, or SDK-owned server.

### Hyprland press/release drives sampled stroke selection

Hyprland binds `Super + middle-button` press and release to Lua callbacks. Each callback reads the compositor cursor position synchronously at the input event, rounds it to a global pixel coordinate, and sends it to AGS in a separate request. Between those events, the AGS drawing overlay samples the compositor cursor and records one bounded global stroke. The cursor outline remains enabled while the selector, composition prompt, request, answer, or failure surface is visible and is disabled only when the workflow is cancelled, torn down, or returns to idle. If process scheduling delivers release before press, AGS holds the release coordinate briefly until the matching start request arrives.

AGS derives padded bounds from a valid corridor or closed stroke. A stroke too short to establish bounds enters click mode and uses a bounded monitor-local target fallback. Local accessibility lookup may refine either rectangle; failure leaves the stroke or click geometry unchanged. A resolved capture is an exact-window candidate only when exactly one client in a fresh snapshot has identical global geometry.

After release and optional local refinement, AGS validates signed global X/Y origins, positive dimensions, and maximum pixel area. It calls `grim` with the final geometry and captures PNG directly into private runtime storage.

Alternative considered: use `slurp`. Rejected because a Hyprland binding consumes the activating mouse press before `slurp` starts, requiring a second drag interaction.

Alternative considered: use `grimblast save area`. Rejected because it owns selection internally and does not expose the geometry needed for contextual matching.

Alternative considered: derive a rectangle only from press and release coordinates. Rejected because it removes the established freehand stroke interaction, padded corridor/closed-shape targeting, and bounded click behavior.

### Hyprland context is a bounded snapshot, not target certainty

Immediately after resolving the final capture geometry, AGS obtains client, layer, monitor, and active-window snapshots through the existing IPC service. It compares that rectangle with client and layer rectangles using strict positive-area intersection. The payload retains at most five client and five layer candidates, ranked deterministically by selection coverage, candidate coverage, center containment, and active-window relation. It truncates window class, title, namespace, and workspace names to bounded values.

For exact-window selections, the payload contains one revalidated window's class, title, workspace, monitor, geometry relationship, active state, floating state, and fullscreen state. For freeform selections, it contains geometric candidates with overlap metrics and the explicit limitation that they are not compositor hit-test, z-order, or visible-pixel facts.

The payload excludes client addresses, stable IDs, PIDs, initial titles/classes, process data, and raw Hyprland JSON. Layer candidates that belong to the AI Pointer or selection surface are excluded. Client/layer/monitor/active-window calls are separate snapshots and are timestamped accordingly.

Alternative considered: claim the first overlapping client is selected. Rejected because client-list ordering is not established as z-order and layers can visually or interactively overlap clients.

### Explicit typed submission is the consent boundary

AGS validates the captured image before composition, calculates a SHA-256 digest, and sends that digest in the request. The runtime reads and validates the file once, checks the digest, and creates the SDK file part from the verified bytes. The captured and sent image are therefore the same bytes on controlled paths.

The prompt view is a compact pointer-adjacent text pill. It appears immediately on release and accepts text while local target resolution and capture continue, with submission disabled until capture validation completes. Backend readiness runs independently and cannot delay drawing cleanup, capture, or prompt rendering; a submission made before readiness completes waits on that prerequisite. It does not replay the selected image or expose the private context envelope. The completed drawing is cleared on release. The geometry highlight is deferred until local accessibility resolution has either selected a target or returned the stroke fallback, so the overlay maps once at its final size. It renders strictly outside the capture rectangle, allowing the same surface to remain mapped through capture and composition without contaminating the attachment or flickering on a state transition. Enter submits a trimmed non-empty question once ready; Escape discards. During a request the action position shows progress and becomes a cancel action on hover or focus. When an answer arrives, the geometry highlight is removed and the answer appears as a lightweight attached surface.

Alternative considered: immediately submit after drag selection. Rejected because it makes accidental selection and surrounding-context disclosure too easy.

### Feature-local AGS ownership prevents stale results and leaks

The feature is a vertical slice under `.config/ags/components/ai-pointer/`. Its XState machine holds serializable state only. A controller owns GTK surfaces, GLib sources, `Gio.Cancellable` instances, `Gio.Subprocess` instances, run-specific capture paths, and cleanup closures.

Each activation has an immutable run ID. Completion events include that ID and are ignored when they do not match the active run. This prevents a late cancelled request from rendering over or cleaning a newer interaction.

Captures reside in `$XDG_RUNTIME_DIR/ai-pointer` with a private directory and unpredictable names. There is no fallback to `/tmp`, screenshots, or clipboard locations. Initialization removes stale files known to belong to this feature; controlled terminal paths remove their run's files.

Alternative considered: one mutable singleton capture path. Rejected because cancel-and-restart races can associate the wrong prompt with a capture or delete a new capture.

### Results stay plain and bounded

The response renderer treats model output as plain text. It does not parse markup, activate links, invoke commands, or offer automatic actions. AI Pointer layers remain visible to ordinary screenshot and screen-sharing tools. Before showing a result and during active work, the controller checks session lock state; a locked session cancels/hides the workflow and cleans controlled resources.

Alternative considered: render rich model markdown. Rejected because markup and links turn untrusted model output into a larger desktop interaction surface.

## Risks / Trade-offs

- [A provider continues processing after local cancellation] -> Abort the OpenCode session, delete it on every path, state local cleanup failure clearly, and do not claim provider-side deletion.
- [A window, layer, focus state, or monitor changes between IPC queries] -> Timestamp the context, describe it as a point-in-time snapshot, and never represent geometric candidates as hit-test facts.
- [An external server has stale configuration or a different version] -> Require compatibility and policy checks before content submission; otherwise use an owned server or fail safely.
- [The selected image contains prompt injection] -> XML-escape and classify image-derived context as untrusted, use an exact read-only web tool allowlist, render output literally, and provide no mutation path.
- [Capture files survive a crash] -> Restrict files to private runtime storage and remove stale feature-owned files at component initialization; uncontrolled process termination cannot provide a deletion guarantee.
- [Image capture or response is large] -> Enforce protocol, image, pixel, prompt, output, and timeout limits before expensive work.

## Migration Plan

1. Add the pinned libexec SDK dependency and protocol/runtime tests with no AGS or Hyprland wiring.
2. Add and verify the deny-by-default `desktop-pointer` agent, exact read-only web tool allowlist, and compatible image-capable model behavior.
3. Add the AGS feature slice, private capture lifecycle, and request subprocess integration behind direct AGS requests.
4. Validate selection, question composition, context envelope, cancellation, lock behavior, and cleanup before adding the Hyprland bind.
5. Register the bundled component, styles, layer rule, and binding.
6. Roll back by removing the binding first, then unregistering the AGS feature. The request runtime and hidden agent are inert without callers.
7. Replace the internal protocol version 1 caller and runtime together with protocol version 2, then rebuild and restart the long-lived AGS daemon before invoking the helper. No compatibility mode is required because there is no persisted data or external consumer after that coordinated restart.

No AI Commit migration or rollback step is required because that workflow is not changed.
