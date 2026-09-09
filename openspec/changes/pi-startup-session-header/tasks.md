## 1. Extension-first contracts and runtime gap audit

- [x] 1.1 Inventory each required field against Pi's public extension APIs, existing local owner state, `pi-context-view`, and `@liborw/pi-startup-time`; verification: every field maps to an extension-owned source or a documented runtime-only gap.
- [x] 1.2 Define immutable, session-scoped owner request, reply, and change envelopes plus optional publisher discovery; verification: contract tests cover absent publishers, incompatible publisher schemas, generation replacement, and revision ordering.
- [x] 1.3 If runtime-only gaps remain, align the local SDK with Pi 0.85.1 and add one narrow typed read-only capability for only those facts; verification: declarations compile with the pinned runtime and no extension-obtainable or startup-timing field appears in the capability.
- [x] 1.4 If task 1.3 adds a Pi patch, keep it behind the existing version assertion in `/home/fbb/nixos/modules/development/ai/pi/default.nix`; verification: the patch applies with zero fuzz and targeted Nix evaluation rejects unsupported Pi versions.
- [x] 1.5 Register the header independently of optional publishers and runtime capabilities; verification: no-patch, absent-publisher, incompatible-schema, and compatible-capability fixtures omit only unavailable sections without notices.

## 2. Header lifecycle and baseline rendering

- [x] 2.1 Implement the startup header view model and lifecycle that subscribes before its initial request, filters session and generation IDs, and rejects older owner revisions; verification: tests cover reload generation replacement, stale revision rejection, and delayed A to B to A replies.
- [x] 2.2 Dispose subscriptions and local deadline timers when the session or header owner changes; verification: late replies and expired timers from disposed generations do not update the header.
- [x] 2.3 Add a passive adapter for `@liborw/pi-startup-time` that accepts only a new valid `startup-time` entry from the current dispatch and preserves module-load-to-`session_start` semantics; verification: tests cover startup, reload, prior-entry rejection, invalid data, handler ordering, and absent-package omission without an independent timer.
- [x] 2.4 Render Git branch, linked-worktree path, available resolved extension and skill totals, coverage-qualified updates adjacent to extensions, and the optional frozen startup duration; verification: fixtures cover ordinary, linked, detached, non-Git, unavailable, load-failed, zero-project-subset, partial-update, complete-zero-update, and omitted startup states.
- [x] 2.5 Preserve Pi's loaded-resource listing, transcript, editor, and prompt footer without duplicating model or thinking state; verification: an interactive startup fixture contains each existing region once.

## 3. Structured publisher safety and integration status

- [x] 3.1 Define immutable structured owner request, reply, and change contracts with allowlisted fields, optional publisher discovery, and owner freshness timestamps; verification: publisher tests cover absent-owner omission plus installed-owner `unavailable`, `collecting`, `ready`, `degraded`, `disposed`, observed-at, stale-at, and expiry transitions.
- [x] 3.2 Sanitize every externally derived profile, provider, window, server, candidate, path, diagnostic, and next-step label before styling or width measurement; verification: OSC, CSI, ESC, C0, C1, line-separator, field-bound, and canary-secret tests pass with no command args, environment values, raw errors, or private IDs rendered.
- [x] 3.3 Implement passive publishers for Neovim, direnv, and LSP with visible `✓`, `!`, and `?` semantics; verification: fixtures cover standalone Neovim omission, unchecked LSP, observed-document LSP readiness, workspace mismatch, blocked, unavailable, and a problem without a verified next step.
- [x] 3.4 Prove the header does not create a Neovim channel, evaluate or approve direnv, start an LSP, infer health from silence, poll, or fetch; verification: integration no-side-effect spies remain unused.

## 4. Workspace identity and tool candidates

- [x] 4.1 Resolve linked-worktree identity through common-dir and worktree metadata rather than a `.git` file alone; verification: linked-worktree, submodule, separate-gitdir, detached, non-Git, and inspection-failure fixtures pass.
- [x] 4.2 Extract formatter and LSP applicability into bounded pure matchers over canonical startup cwd ancestors up to canonical repository or worktree root; verification: tests enforce 32 ancestor levels, 256 configured entries, 16 markers per entry, 64 displayed unique candidates per kind, and no recursive scan.
- [x] 4.3 Preserve matching-file, root-marker, unconditional formatter, and first-available formatter-order semantics without executable claims; verification: marker, unconditional, fallback-order, and execution/spawn-unused tests pass.
- [x] 4.4 Render distinct trust-disabled, invalid-settings, incomplete or limit-reached, none, and unavailable candidate states; verification: fixtures cover each state and retain explicit overflow information.

## 5. Auth observations and deadlines

- [x] 5.1 Extend in-memory provider usage snapshots with stable window identity and separate observed-at, stale-at, allowance-reset, and banked-expiry timestamps; verification: provider parsing, stale-data, reset, expiry, and zero-banked-reset tests pass.
- [x] 5.2 Schedule one-shot local deadline notifications and recompute from absolute timestamps after suspend or clock change; verification: idle-expiry and clock-change tests prove transitions do not poll, fetch, refresh, consume credits, or imply replenishment.
- [x] 5.3 Keep the existing legacy auth cache readable without migration, reconstruction, or fetch; verification: legacy-cache and downgrade tests render metadata-unavailable for window identity and absolute reset fields.
- [x] 5.4 Render the passive effective auth chain with active and next profiles, provider windows, and explicit missing, stale, errored, and not-reported states; verification: ordering, independent reset-expiry, sanitization, and narrow-width fixtures pass.

## 6. Resource resolution and initial context

- [x] 6.1 Resolve enabled extension entrypoints and available skills through extension APIs where possible, using a minimal runtime aggregate only for any proven gap; verification: duplicate, winning-project-scope, explicit load-failed, and absent-capability fixtures produce truthful output or omit the section.
- [x] 6.2 Publish update coverage as `complete`, `partial`, `offline`, or `failed` through an optional extension-owned publisher; verification: tests show confirmed findings plus an incomplete label for partial coverage, show zero only for complete coverage, and omit updates when the publisher is absent.
- [x] 6.3 Add a structured `pi-context-view` publisher that shares category, configured-color, and glyph semantics with the header without copying prototype colors; verification: full, partial, compacted, reserve, free, overridden-color, and absent-publisher cases pass.
- [x] 6.4 Render the frozen 14 by 1 full-window base initial-context estimate from static loaded startup inputs without synthetic hooks or turns; use a minimal runtime aggregate only if public extension APIs cannot provide the required totals; verification: six-percent reserve allocation, resume exclusion of session messages, unknown capacity, absent-source omission, and prompt-footer ownership fixtures pass.
- [x] 6.5 Prove runtime capabilities, extension-owner snapshots, and header state expose no raw prompt, tool schema, context-file content, skill content, message, or credential; verification: snapshot redaction tests pass.

## 7. Rendering and integration validation

- [x] 7.1 Implement width-aware section degradation and Pi theme updates without data probes; verification: representative wide and narrow normative fixtures preserve borders, readable output, visible status semantics, timestamps, and stale markers.
- [ ] 7.2 Run neighboring extension tests and `devenv test`, then resolve any regression without weakening existing checks; verification: targeted tests and the relevant `devenv test` suite pass.
- [x] 7.3 Validate no-patch startup and, if a minimal Pi patch remains, run the NixOS repository's existing Pi package checks; verification: baseline, missing-optional-publisher, linked-worktree, and integration-problem fixtures compare with `references/start-screen-concepts.html` only where its layout and style do not conflict with normative behavior.
