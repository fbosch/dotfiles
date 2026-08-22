## 0. Selection And Consent Slice

- [x] 0.1 Add the bundled AI Pointer component, strict `start` request boundary, `Super + middle-click` binding, and layer surface.
- [x] 0.2 Implement one-run XState stroke selection, private runtime capture storage, sampled global geometry between Hyprland press/release callbacks, direct `grim` capture, and controlled Escape/shutdown cleanup.
- [x] 0.3 Add a local text-only composition prompt and disabled Ask control so no image can leave the machine in this slice.
- [x] 0.4 Add pure geometry, request, and machine coverage plus a native GJS prompt-surface lifecycle check.
- [x] 0.5 Manually verify middle-button stroke and click selection, screenshot accuracy, composition, and Escape cleanup.

## 1. Runtime Prerequisites

- [x] 1.1 Add the compatible `@opencode-ai/sdk` range `^1.18.21` to `.config/opencode/libexec/package.json` and regenerate `.config/opencode/libexec/bun.lock` through Bun.
- [x] 1.2 Confirm the installed OpenCode binary, pinned SDK, and generated SDK APIs support compatible health checks, agent/tool discovery, image file parts, session abort, and session deletion.
- [x] 1.3 Add the hidden `desktop-pointer` primary agent with a component-owned answer-only system prompt, deny-by-default tools, and an exact read-only web lookup allowlist.
- [x] 1.4 Verify the configured default model accepts PNG input for the new agent and record the safe unavailable behavior for models that do not.

## 2. OpenCode Request Protocol

- [x] 2.1 Create `.config/opencode/libexec/answer-request/` with a library entry point, CLI entry point, backend-neutral protocol types, attachment validation, and colocated tests.
- [x] 2.2 Define closed Zod schemas for protocol version 1 requests, successes, failures, error codes, attachment descriptors, limits, and tool policies.
- [x] 2.3 Enforce one bounded JSON request on stdin, reject invalid UTF-8, trailing input, unsupported versions, unknown fields, empty prompts, and invalid timeout ranges.
- [x] 2.4 Emit exactly one newline-terminated JSON result on stdout and route diagnostics to bounded, redacted stderr only.
- [x] 2.5 Add protocol tests for valid requests, malformed input, oversized input, unknown fields, unsupported versions, and stdout contamination.

## 3. Attachment Integrity And Response Normalization

- [x] 3.1 Implement regular-file, MIME, magic-byte, image-dimension, pixel-count, byte-count, aggregate-count, and SHA-256 validation for PNG and JPEG attachments.
- [x] 3.2 Read each accepted attachment once and construct its OpenCode file part from the verified bytes rather than passing a mutable file path to OpenCode.
- [x] 3.3 Reject symlinks, non-regular files, MIME mismatches, excessive images, and digest changes without submitting content.
- [x] 3.4 Normalize only final assistant text parts, exclude reasoning/tool/provider parts, bound output size, explicitly mark truncation, and reject empty output.
- [x] 3.5 Add attachment and normalization tests, including changed files after capture, high-pixel images, mixed response parts, empty responses, and redacted failure diagnostics.

## 4. OpenCode Server And Session Lifecycle

- [x] 4.1 Define the deep `AnswerBackend.execute()` interface and implement the OpenCode adapter with fixed-loopback health, version, agent, image-capability, and read-only web tool-policy checks before attachment transmission.
- [x] 4.2 Implement owned ephemeral-server startup when external reuse is unavailable or unsuitable, and model external versus owned ownership explicitly.
- [x] 4.3 Implement ephemeral session creation, prompt submission with an exact read-only web tool map, final response extraction, and session deletion after success.
- [x] 4.4 Implement timeout, SIGINT, SIGTERM, and caller cancellation using independent fresh deadlines for session abort, session deletion, and owned-server closure.
- [x] 4.5 Ensure external servers are never restarted, terminated, or closed, while owned servers close exactly once on every terminal path.
- [x] 4.6 Launch the helper through `bun run --no-install` and reject unvalidated OpenCode/SDK version combinations before prompt or attachment submission.
- [x] 4.7 Add backend-contract, fake-server, and SDK-lifecycle tests for external reuse, owned fallback, missing agent, tool-policy rejection, success, provider failure, timeout, cancellation, cleanup failure, version mismatch, and caller independence from OpenCode-specific fields.

## 5. AI Pointer Selection And Context Model

- [x] 5.1 Add pure feature-local types and policies for global selection geometry, exact window resolution, geometric client/layer candidates, privacy filtering, and context prompt formatting.
- [x] 5.2 Record Hyprland cursor positions in the synchronous `Super + middle-button` press and release bind callbacks and sample one bounded pointer stroke between them.
- [x] 5.3 Validate stroke-derived or click-fallback geometry for signed origins, positive dimensions, and the maximum capture area.
- [x] 5.4 Query fresh Hyprland clients, layers, monitors, active window, and lock state after selection through the existing IPC service.
- [x] 5.5 Capture the final stroke-, click-, or accessibility-resolved geometry with `grim`, validate the PNG, calculate its SHA-256 digest, and reject partial or invalid captures before composition.
- [x] 5.6 Revalidate exact whole-window captures only when one fresh client geometry exactly matches the final capture rectangle.
- [x] 5.7 Calculate deterministic positive-area overlap metrics for freeform client and layer candidates, cap candidate counts, and label them as geometric inference rather than hit-test or z-order facts.
- [x] 5.8 Exclude AI Pointer and selector layer namespaces, local addresses, stable IDs, PIDs, process data, and raw Hyprland JSON from the AI-facing context envelope.
- [x] 5.9 Add pure tests for negative monitor origins, stale exact-geometry matches, overlapping windows, layer intersections, no candidates, active-window mismatch, privacy filtering, and deterministic ranking.

## 6. AGS AI Pointer Workflow

- [x] 6.1 Create `.config/ags/components/ai-pointer/` with a typed XState machine, controller, view, request handler, styles, and colocated tests.
- [x] 6.2 Model idle, selection, composition, requesting, answered, failed, and cancellation transitions; ensure repeated activation while active does not start a second selector.
- [x] 6.3 Give every activation an immutable run ID and keep run-owned GTK, GLib, subprocess, cancellable, capture, and cleanup resources outside machine context.
- [x] 6.4 Create a feature-private `$XDG_RUNTIME_DIR/ai-pointer` directory, use unpredictable capture names, remove stale feature-owned files at initialization, and never fall back to `/tmp`, screenshots, or clipboard storage.
- [x] 6.5 Integrate direct `grim` capture with cooperative cancellation, bounded hard-kill fallback, and cleanup for every controlled terminal path.
- [x] 6.6 Invoke the Bun request CLI through a JSON stdin/stdout subprocess contract and ignore completion events that do not match the active run ID.
- [x] 6.7 On lock detection, cancel/hide active work and prevent answer presentation over the lock screen.
- [x] 6.8 Add machine and GJS integration tests for Escape in every state, stale completion rejection, private capture cleanup, malformed selector output, partial capture failure, helper timeout, and lock cancellation.

## 7. AGS Presentation And Consent

- [x] 7.1 Build a compact pointer-adjacent text pill with a content-growing question entry, stable action position, request status, attached result, and concise failure states.
- [x] 7.2 Require a non-empty typed question and explicit Enter submission; Escape from composition must discard the capture without sending data.
- [x] 7.3 Render results as bounded literal plain text with markup, automatic links, clipboard actions, command dispatch, and mutation affordances disabled.
- [x] 7.4 Keep captured pixels and the private context envelope out of the composition surface while retaining explicit Enter submission as the consent boundary.
- [x] 7.5 Position and clamp the surface to the relevant monitor, including negative monitor origins and transformed monitor geometry.
- [x] 7.6 Add feature styles through the bundled stylesheet manifest and preserve shared Gaming opacity behavior.

## 8. Desktop Registration And Hardening

- [x] 8.1 Register the AI Pointer component in `.config/ags/config-bundled.tsx` with strict component request parsing.
- [x] 8.2 Add static Hyprland layer rules for the AI Pointer namespaces with the established shell-surface presentation behavior.
- [x] 8.3 Add the provisional `Super + middle-click` Hyprland binding that opens the AI Pointer through the bundled AGS request interface.
- [x] 8.4 Preflight selection, capture, Bun, helper, agent, compatible OpenCode server, and image-capable model availability so missing dependencies return a concise failure without blocking Hyprland.
- [x] 8.5 Verify a partially deployed helper, agent, AGS component, or keybind fails safely and cannot leave a selector or capture active.

## 9. Validation

- [x] 9.1 Run request-runtime unit and fake-server lifecycle tests from `.config/opencode/libexec/`.
- [x] 9.2 Run `bunx tsc -p .config/opencode/libexec/tsconfig.json`.
- [x] 9.3 Run targeted AGS pure tests and GJS integration tests for the AI Pointer feature.
- [x] 9.4 Run the relevant AGS line/style/quality checks and bundle check.
- [x] 9.5 Run `hyprctl configerrors` after the Hyprland binding and layer-rule changes.
- [x] 9.6 Run `stow -n .` from the dotfiles repository root.
- [ ] 9.7 Manually verify selection, content-growing composition, requesting cancellation, submission, attached answer rendering, all Escape paths, unavailable dependencies, oversized images, version mismatch, timeout, cleanup failure, and locked-session behavior.
- [ ] 9.8 Verify no AI Pointer capture or ephemeral OpenCode session remains after success, failure, timeout, cancellation, or an AGS restart.
- [x] 9.9 Verify AI Commit remains byte-for-byte unchanged with `git diff --exit-code -- .config/opencode/plugins/ai-commit .config/fish/functions/ai_commit.fish`.
- [x] 9.10 Run `openspec validate ags-ai-pointer-query --type change --strict --no-interactive`.

## 10. Streaming Answer Delivery

- [x] 10.1 Replace protocol version 1 with a closed, bounded protocol-version-2 NDJSON event contract and tests.
- [x] 10.2 Stream exactly correlated OpenCode assistant text through `event.subscribe` and `session.promptAsync`, then retrieve and validate the final message before cleanup.
- [x] 10.3 Parse bounded NDJSON incrementally through Gio and reject malformed framing, ordering, stale IDs, invalid UTF-8, and unsuccessful terminal process outcomes.
- [x] 10.4 Present provisional plain text during `requesting`, replace it on terminal success, and clear it on cancellation, lock, failure, or stale completion.
- [x] 10.5 Run scoped Bun, TypeScript, AGS, GJS, bundle, and strict OpenSpec validation, then verify one live streamed request and cleanup path.
