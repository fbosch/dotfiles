## Context

See `proposal.md` for motivation and the two capability specs for behavior. AGS currently has a synchronous Hyprland IPC client, a cursor-monitor helper, bundled component routing, and XState controllers for temporal UI behavior. It has no AI request client or drag-selection component. OpenCode SDK use currently exists in AI Commit, but that workflow is intentionally not an integration point for this change.

Hyprland exposes client, layer, monitor, active-window, cursor, and lock snapshots through its IPC query socket. Its existing `grimblast area` wrapper internally runs `slurp`, but it returns a captured path rather than the selected geometry and optional client label needed to derive application context. `slurp` is present in Grimblast's closure but is not directly on `PATH`.

## Goals / Non-Goals

**Goals:**

- Keep pointer selection, capture, presentation, and cancellation in one AGS feature slice.
- Keep OpenCode SDK, server, session, attachment, and response-shape knowledge in one Bun runtime boundary.
- Send the smallest reviewed image and compositor metadata needed to explain the selection.
- Make the model request read-only by construction and preserve cancellation/resource ownership across AGS and Bun process boundaries.
- Preserve a stable machine protocol that future non-interactive OpenCode consumers can use without inheriting pointer UI behavior.

**Non-Goals:**

- Extracting, sharing code with, or changing AI Commit.
- Building a generic multi-provider framework, streaming protocol, conversation store, or desktop automation layer.
- Treating a rectangle overlap as a compositor hit test, visible-pixel calculation, or z-order assertion.
- Collecting `/proc` command lines, process working directories, clipboard contents, OCR, accessibility trees, or semantic application content.
- Capturing ambient screen data, listening for voice, or retaining sessions for follow-up conversation.

## Decisions

### A separate Bun request boundary isolates OpenCode from AGS

The request runtime lives under `.config/opencode/libexec/opencode-request/` and has a library API plus a JSON stdin/stdout CLI. AGS invokes the CLI through `Gio.Subprocess` with argv arrays; it never imports Node or Bun SDK code.

The protocol owns validation, data-URL construction from verified image bytes, OpenCode connection, server ownership, session lifecycle, cancellation, final-text normalization, and machine-safe errors. The caller owns prompt wording, selection, capture, preview, rendering, and any retry UX.

Alternative considered: make an AGS service call OpenCode directly. Rejected because GJS and Bun have separate dependency and lifecycle models, and it would spread SDK compatibility/cancellation details into the desktop process.

Alternative considered: reuse AI Commit's generator. Rejected because it owns commit prompts, parsing, server UI, and terminal behavior. The request runtime is introduced alongside it; AI Commit remains unchanged.

### Protocol version 1 is closed, bounded, and answer-only

The CLI accepts one JSON request with a run ID, fixed trusted directory, agent, optional model, deny-all tool policy, prompt text, attachment descriptors, and timeout. It returns one success or error response with the same run ID. Zod validates both input and external response boundaries. The runtime never writes progress, SDK logs, or provider output to stdout.

The initial Pointer caller uses the fixed OpenCode configuration directory and fixed `desktop-pointer` agent. It does not derive the directory, agent, tools, server URL, or model from the focused window, selected text, image, or user prompt. The generic runtime can retain explicit directory and model inputs for future trusted callers, but pointer policy remains fixed and local.

The deny-all policy combines the `desktop-pointer` agent's `tools: { "*": false }` configuration with a request-time all-known-tool denial map. The implementation verifies this behavior against the pinned OpenCode version. If the runtime cannot enumerate and deny the available tools or cannot resolve the requested agent, it fails before transmitting user content.

Alternative considered: pass a caller-defined tool map. Rejected because it makes the desktop capture boundary an authority boundary and is not required for read-only Q&A.

### Pinned SDK and owned-server fallback contain compatibility drift

The libexec Bun package pins `@opencode-ai/sdk` to `1.18.18`, matching the currently installed `opencode` binary. The helper is launched with `bun run --no-install`, preventing first-use package mutation or registry access.

The runtime probes only the fixed loopback endpoint already used for local OpenCode service reuse. It requires a bounded health response, validated version compatibility, and successful agent/tool-policy verification before attaching user data. If the endpoint is absent or unsuitable, it starts an SDK-owned ephemeral server. Ownership is represented explicitly so only the owned branch can close a server.

External server reuse is a latency optimization, not an authentication mechanism against software running as the same local user. The runtime does not scan ports, accept remote URLs, restart an external server, or terminate one.

Alternative considered: always start a server. Rejected because it adds startup latency and duplicate server processes to every pointer request.

Alternative considered: use a reachable server without verification. Rejected because a stale server can have an incompatible SDK/API, missing agent, broader configuration, or another provider account.

### Every request has an ephemeral, independently cleaned lifecycle

Each request creates one session. On normal completion it deletes that session. On timeout, cancellation, SIGINT, or SIGTERM it attempts `session.abort`, then `session.delete`, then closes an owned server. Each operation gets a fresh, bounded signal; an expired prompt signal must not prevent cleanup. Cleanup is idempotent and reports `cleanup_failed` when a local session cannot be removed.

AGS first requests cooperative helper termination and gives it a short grace period to run this cleanup. Only then may it force-exit the helper. A forced helper exit cannot guarantee provider-side cancellation, so the UI never claims that remote/provider data was deleted.

Alternative considered: terminate Bun immediately on Escape. Rejected because it can orphan an active OpenCode request, session, or SDK-owned server.

### Direct slurp selection preserves selection geometry and client identity

The coordinated NixOS change adds `pkgs.slurp` to `modules/desktop/hyprland.nix`. AGS queries visible Hyprland clients before selection and presents their global rectangles to `slurp` with optional stable-ID labels. It invokes `slurp` with a format that returns canonical global geometry and the optional label.

A selection with a valid label is an exact-window candidate only after the client is re-resolved in a fresh snapshot and its stable identity still matches. A freeform drag has no claimed compositor target; it is a region selection.

After selection, AGS validates signed global X/Y origins, positive dimensions, maximum pixel area, one optional label, and no trailing output. It calls `grim` with the validated geometry and captures PNG directly into private runtime storage.

Alternative considered: use `grimblast save area`. Rejected because it owns `slurp` internally and does not expose the selected geometry/label needed for contextual matching.

Alternative considered: build a GTK drag overlay. Rejected because multi-monitor global coordinate conversion, overlay input, and compositor integration would duplicate mature Wayland selection behavior without a concrete need.

### Hyprland context is a bounded snapshot, not target certainty

Immediately after selection, AGS obtains client, layer, monitor, and active-window snapshots through the existing IPC service. It compares the selected global rectangle with client and layer rectangles using strict positive-area intersection. The payload retains at most five client and five layer candidates, ranked deterministically by selection coverage, candidate coverage, center containment, and active-window relation. It truncates window class, title, namespace, and workspace names to bounded values.

For exact-window selections, the payload contains one revalidated window's class, title, workspace, monitor, geometry relationship, active state, floating state, and fullscreen state. For freeform selections, it contains geometric candidates with overlap metrics and the explicit limitation that they are not compositor hit-test, z-order, or visible-pixel facts.

The payload excludes client addresses, stable IDs, PIDs, initial titles/classes, process data, and raw Hyprland JSON. Layer candidates that belong to the AI Pointer or selection surface are excluded. Client/layer/monitor/active-window calls are separate snapshots and are timestamped accordingly.

Alternative considered: claim the first overlapping client is selected. Rejected because client-list ordering is not established as z-order and layers can visually or interactively overlap clients.

### The capture preview is the consent boundary

AGS validates the captured image before previewing it, calculates a SHA-256 digest, and sends that digest in the request. The runtime reads and validates the file once, checks the digest, and creates the SDK file part from the verified bytes. The preview and sent image are therefore the same bytes on controlled paths.

The prompt view displays the selected image and a concise list of title/class/workspace context that will accompany it. Enter submits; Escape discards. The surface explains that submission sends the reviewed content to the configured model provider but does not promise provider-side deletion.

Alternative considered: immediately submit after drag selection. Rejected because it makes accidental selection and surrounding-context disclosure too easy.

### Feature-local AGS ownership prevents stale results and leaks

The feature is a vertical slice under `.config/ags/components/ai-pointer/`. Its XState machine holds serializable state only. A controller owns GTK surfaces, GLib sources, `Gio.Cancellable` instances, `Gio.Subprocess` instances, run-specific capture paths, and cleanup closures.

Each activation has an immutable run ID. Completion events include that ID and are ignored when they do not match the active run. This prevents a late cancelled request from rendering over or cleaning a newer interaction.

Captures reside in `$XDG_RUNTIME_DIR/ai-pointer` with a private directory and unpredictable names. There is no fallback to `/tmp`, screenshots, or clipboard locations. Initialization removes stale files known to belong to this feature; controlled terminal paths remove their run's files.

Alternative considered: one mutable singleton capture path. Rejected because cancel-and-restart races can associate the wrong preview or delete a new capture.

### Results stay plain, bounded, and invisible to screen sharing

The response renderer treats model output as plain text. It does not parse markup, activate links, invoke commands, or offer automatic actions. The AGS layer has `no_screen_share` enabled. Before showing a result and during active work, the controller checks session lock state; a locked session cancels/hides the workflow and cleans controlled resources.

Alternative considered: render rich model markdown. Rejected because markup and links turn untrusted model output into a larger desktop interaction surface.

## Risks / Trade-offs

- [A provider continues processing after local cancellation] -> Abort the OpenCode session, delete it on every path, state local cleanup failure clearly, and do not claim provider-side deletion.
- [A window, layer, focus state, or monitor changes between IPC queries] -> Timestamp the context, describe it as a point-in-time snapshot, and never represent geometric candidates as hit-test facts.
- [An external server has stale configuration or a different version] -> Require compatibility and policy checks before content submission; otherwise use an owned server or fail safely.
- [The selected image contains prompt injection] -> Use an answer-only agent with deny-all tools, fixed trusted execution context, literal rendering, and no action path.
- [Capture files survive a crash] -> Restrict files to private runtime storage and remove stale feature-owned files at component initialization; uncontrolled process termination cannot provide a deletion guarantee.
- [The NixOS prerequisite is not deployed] -> Preflight `slurp` and return a concise unavailable state before opening the workflow.
- [Image capture or response is large] -> Enforce protocol, image, pixel, prompt, output, and timeout limits before expensive work.

## Migration Plan

1. Add `pkgs.slurp` to the NixOS desktop package set and rebuild the target host so it is directly available on `PATH`.
2. Add the pinned libexec SDK dependency and protocol/runtime tests with no AGS or Hyprland wiring.
3. Add and verify the no-tool `desktop-pointer` agent and compatible image-capable model behavior.
4. Add the AGS feature slice, private capture lifecycle, and request subprocess integration behind direct AGS requests.
5. Validate selection, capture preview, context envelope, cancellation, lock behavior, and cleanup before adding the Hyprland bind.
6. Register the bundled component, styles, layer rule, and binding.
7. Roll back by removing the binding first, then unregistering the AGS feature. The request runtime and hidden agent are inert without callers.

No AI Commit migration or rollback step is required because that workflow is not changed.
