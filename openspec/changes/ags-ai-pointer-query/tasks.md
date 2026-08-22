## 0. Selection And Consent Slice

- [x] 0.1 Add the bundled AI Pointer component, strict `start` request boundary, `Super + middle-click` binding, and private no-screen-share layer surface.
- [x] 0.2 Implement one-run XState stroke selection, private runtime capture storage, sampled global geometry between Hyprland press/release callbacks, direct `grim` capture, and controlled Escape/shutdown cleanup.
- [x] 0.3 Add a local capture preview and disabled Ask control so no image can leave the machine in this slice.
- [x] 0.4 Add pure geometry, request, and machine coverage plus a native GJS preview-surface lifecycle check.
- [x] 0.5 Manually verify middle-button stroke and click selection, screenshot accuracy, preview, and Escape cleanup.

## 1. Runtime Prerequisites

- [x] 1.1 Add an exact `@opencode-ai/sdk` `1.18.18` dependency to `.config/opencode/libexec/package.json` and regenerate `.config/opencode/libexec/bun.lock` through Bun.
- [x] 1.2 Confirm the installed OpenCode binary, pinned SDK, and generated SDK APIs support compatible health checks, agent/tool discovery, image file parts, session abort, and session deletion.
- [x] 1.3 Add the hidden `desktop-pointer` primary agent with `tools: { "*": false }`, a minimal provider-prompt-suppressing bootstrap, and no action or tool-use path; keep answer-only instructions runtime-owned.
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
- [x] 3.5 Add attachment and normalization tests, including changed files after preview, high-pixel images, mixed response parts, empty responses, and redacted failure diagnostics.

## 4. OpenCode Server And Session Lifecycle

- [x] 4.1 Define the deep `AnswerBackend.execute()` interface and implement the OpenCode adapter with fixed-loopback health, version, agent, image-capability, and deny-all tool-policy checks before attachment transmission.
- [x] 4.2 Implement owned ephemeral-server startup when external reuse is unavailable or unsuitable, and model external versus owned ownership explicitly.
- [x] 4.3 Implement ephemeral session creation, prompt submission with the deny-all tool map, final response extraction, and session deletion after success.
- [x] 4.4 Implement timeout, SIGINT, SIGTERM, and caller cancellation using independent fresh deadlines for session abort, session deletion, and owned-server closure.
- [x] 4.5 Ensure external servers are never restarted, terminated, or closed, while owned servers close exactly once on every terminal path.
- [x] 4.6 Launch the helper through `bun run --no-install` and reject unvalidated OpenCode/SDK version combinations before prompt or attachment submission.
- [x] 4.7 Add backend-contract, fake-server, and SDK-lifecycle tests for external reuse, owned fallback, missing agent, tool-policy rejection, success, provider failure, timeout, cancellation, cleanup failure, version mismatch, and caller independence from OpenCode-specific fields.

## 5. AI Pointer Selection And Context Model

- [x] 5.1 Add pure feature-local types and policies for global selection geometry, exact window resolution, geometric client/layer candidates, privacy filtering, and context prompt formatting.
- [x] 5.2 Record Hyprland cursor positions in the synchronous `Super + middle-button` press and release bind callbacks and sample one bounded pointer stroke between them.
- [x] 5.3 Validate stroke-derived or click-fallback geometry for signed origins, positive dimensions, and the maximum capture area.
- [x] 5.4 Query fresh Hyprland clients, layers, monitors, active window, and lock state after selection through the existing IPC service.
- [x] 5.5 Capture the final stroke-, click-, or accessibility-resolved geometry with `grim`, validate the PNG, calculate its SHA-256 digest, and reject partial or invalid captures before preview.
- [x] 5.6 Revalidate exact whole-window captures only when one fresh client geometry exactly matches the final capture rectangle.
- [x] 5.7 Calculate deterministic positive-area overlap metrics for freeform client and layer candidates, cap candidate counts, and label them as geometric inference rather than hit-test or z-order facts.
- [x] 5.8 Exclude AI Pointer and selector layer namespaces, local addresses, stable IDs, PIDs, process data, and raw Hyprland JSON from the AI-facing context envelope.
- [x] 5.9 Add pure tests for negative monitor origins, stale exact-geometry matches, overlapping windows, layer intersections, no candidates, active-window mismatch, privacy filtering, and deterministic ranking.

## 6. AGS AI Pointer Workflow

- [ ] 6.1 Create `.config/ags/components/ai-pointer/` with a typed XState machine, controller, view, request handler, styles, and colocated tests.
- [ ] 6.2 Model idle, selection, composition, requesting, answered, failed, and cancellation transitions; ensure repeated activation while active does not start a second selector.
- [ ] 6.3 Give every activation an immutable run ID and keep run-owned GTK, GLib, subprocess, cancellable, capture, and cleanup resources outside machine context.
- [ ] 6.4 Create a feature-private `$XDG_RUNTIME_DIR/ai-pointer` directory, use unpredictable capture names, remove stale feature-owned files at initialization, and never fall back to `/tmp`, screenshots, or clipboard storage.
- [ ] 6.5 Integrate direct `grim` capture with cooperative cancellation, bounded hard-kill fallback, and cleanup for every controlled terminal path.
- [ ] 6.6 Invoke the Bun request CLI through a JSON stdin/stdout subprocess contract and ignore completion events that do not match the active run ID.
- [ ] 6.7 On lock detection, cancel/hide active work and prevent answer presentation over the lock screen.
- [ ] 6.8 Add machine and GJS integration tests for Escape in every state, stale completion rejection, private capture cleanup, malformed selector output, partial capture failure, helper timeout, and lock cancellation.

## 7. AGS Presentation And Consent

- [ ] 7.1 Build a pointer-adjacent review surface with the validated image preview, privacy-minimized application context, question entry, request status, result, and concise failure states.
- [ ] 7.2 Require a non-empty typed question and explicit Enter submission; Escape from composition must discard the capture without sending data.
- [ ] 7.3 Render results as bounded literal plain text with markup, automatic links, clipboard actions, command dispatch, and mutation affordances disabled.
- [ ] 7.4 Show an explicit statement that submission sends the reviewed image, question, and context to the configured model provider without promising provider-side deletion.
- [ ] 7.5 Position and clamp the surface to the relevant monitor, including negative monitor origins and transformed monitor geometry.
- [ ] 7.6 Add feature styles through the bundled stylesheet manifest and preserve shared Gaming opacity behavior.

## 8. Desktop Registration And Hardening

- [ ] 8.1 Register the AI Pointer component in `.config/ags/config-bundled.tsx` with strict component request parsing.
- [ ] 8.2 Add a static Hyprland layer rule for the AI Pointer namespace with `no_screen_share` and the established shell-surface presentation behavior.
- [ ] 8.3 Add the provisional `Super + middle-click` Hyprland binding that opens the AI Pointer through the bundled AGS request interface.
- [ ] 8.4 Preflight selection, capture, Bun, helper, agent, compatible OpenCode server, and image-capable model availability so missing dependencies return a concise failure without blocking Hyprland.
- [ ] 8.5 Verify a partially deployed helper, agent, AGS component, or keybind fails safely and cannot leave a selector or capture active.

## 9. Validation

- [ ] 9.1 Run request-runtime unit and fake-server lifecycle tests from `.config/opencode/libexec/`.
- [ ] 9.2 Run `bunx tsc -p .config/opencode/libexec/tsconfig.json`.
- [ ] 9.3 Run targeted AGS pure tests and GJS integration tests for the AI Pointer feature.
- [ ] 9.4 Run the relevant AGS line/style/quality checks and bundle check.
- [ ] 9.5 Run `hyprctl configerrors` after the Hyprland binding and layer-rule changes.
- [ ] 9.6 Run `stow -n .` from the dotfiles repository root.
- [ ] 9.7 Manually verify selection, preview, context review, submission, answer rendering, all Escape paths, unavailable dependencies, oversized images, version mismatch, timeout, cleanup failure, and locked-session behavior.
- [ ] 9.8 Verify no AI Pointer capture or ephemeral OpenCode session remains after success, failure, timeout, cancellation, or an AGS restart.
- [ ] 9.9 Verify AI Commit remains byte-for-byte unchanged with `git diff --exit-code -- .config/opencode/plugins/ai-commit .config/fish/functions/ai_commit.fish`.
- [ ] 9.10 Run `openspec validate ags-ai-pointer-query --type change --strict --no-interactive`.
