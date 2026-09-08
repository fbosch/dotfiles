## 1. Runtime capability and snapshot contract

- [ ] 1.1 Align the local TypeScript SDK with the pinned Pi 0.85.1 runtime; add `.pi/agent/lib/pi-coding-agent-startup.d.ts` for the immutable startup snapshot capability identifier `pi.startupSnapshot` and schema version `1`; verification: SDK declarations and runtime package compile together.
- [ ] 1.2 Add the guarded Nix patch that publishes sanitized immutable snapshots with session ID, generation ID, owner ID, owner revision, resource provenance, update coverage, startup timing, and static initial-context totals; verification: the patch applies with zero fuzz and runtime snapshot tests pass.
- [ ] 1.3 Gate header registration on the capability and schema handshake before `setHeader`; retain Pi's built-in header and show one nonfatal supported-UI notice when incompatible; verification: tests cover unpatched 0.85.1, 0.84.4, schema-incompatible future Pi, and a compatible patched runtime.
- [ ] 1.4 Keep the patch under `/home/fbb/nixos/modules/development/ai/pi/default.nix` behind the existing Pi version assertion; verification: targeted Nix evaluation rejects an unsupported Pi version.

## 2. Header lifecycle and baseline rendering

- [ ] 2.1 Implement the startup header view model and lifecycle that subscribes before its initial request, filters session and generation IDs, and rejects older owner revisions; verification: tests cover reload generation replacement, stale revision rejection, and delayed A to B to A replies.
- [ ] 2.2 Dispose subscriptions and local deadline timers when the session or header owner changes; verification: late replies and expired timers from disposed generations do not update the header.
- [ ] 2.3 Render Git branch, linked-worktree path, resolved extension and skill totals, coverage-qualified updates adjacent to extensions, and frozen startup duration; verification: fixtures cover ordinary, linked, detached, non-Git, unavailable, load-failed, zero-project-subset, partial-update, and complete-zero-update states.
- [ ] 2.4 Preserve Pi's loaded-resource listing, transcript, editor, and prompt footer without duplicating model or thinking state; verification: an interactive startup fixture contains each existing region once.

## 3. Structured publisher safety and integration status

- [ ] 3.1 Define immutable structured owner request, reply, and change contracts with allowlisted fields and owner freshness timestamps; verification: publisher tests cover `unavailable`, `collecting`, `ready`, `degraded`, `disposed`, observed-at, stale-at, and expiry transitions.
- [ ] 3.2 Sanitize every externally derived profile, provider, window, server, candidate, path, diagnostic, and next-step label before styling or width measurement; verification: OSC, CSI, ESC, C0, C1, line-separator, field-bound, and canary-secret tests pass with no command args, environment values, raw errors, or private IDs rendered.
- [ ] 3.3 Implement passive publishers for Neovim, direnv, and LSP with visible `✓`, `!`, and `?` semantics; verification: fixtures cover standalone Neovim omission, unchecked LSP, observed-document LSP readiness, workspace mismatch, blocked, unavailable, and a problem without a verified next step.
- [ ] 3.4 Prove the header does not create a Neovim channel, evaluate or approve direnv, start an LSP, infer health from silence, poll, or fetch; verification: integration no-side-effect spies remain unused.

## 4. Workspace identity and tool candidates

- [ ] 4.1 Resolve linked-worktree identity through common-dir and worktree metadata rather than a `.git` file alone; verification: linked-worktree, submodule, separate-gitdir, detached, non-Git, and inspection-failure fixtures pass.
- [ ] 4.2 Extract formatter and LSP applicability into bounded pure matchers over canonical startup cwd ancestors up to canonical repository or worktree root; verification: tests enforce 32 ancestor levels, 256 configured entries, 16 markers per entry, 64 displayed unique candidates per kind, and no recursive scan.
- [ ] 4.3 Preserve matching-file, root-marker, unconditional formatter, and first-available formatter-order semantics without executable claims; verification: marker, unconditional, fallback-order, and execution/spawn-unused tests pass.
- [ ] 4.4 Render distinct trust-disabled, invalid-settings, incomplete or limit-reached, none, and unavailable candidate states; verification: fixtures cover each state and retain explicit overflow information.

## 5. Auth observations and deadlines

- [ ] 5.1 Extend in-memory provider usage snapshots with stable window identity and separate observed-at, stale-at, allowance-reset, and banked-expiry timestamps; verification: provider parsing, stale-data, reset, expiry, and zero-banked-reset tests pass.
- [ ] 5.2 Schedule one-shot local deadline notifications and recompute from absolute timestamps after suspend or clock change; verification: idle-expiry and clock-change tests prove transitions do not poll, fetch, refresh, consume credits, or imply replenishment.
- [ ] 5.3 Keep the existing legacy auth cache readable without migration, reconstruction, or fetch; verification: legacy-cache and downgrade tests render metadata-unavailable for window identity and absolute reset fields.
- [ ] 5.4 Render the passive effective auth chain with active and next profiles, provider windows, and explicit missing, stale, errored, and not-reported states; verification: ordering, independent reset-expiry, sanitization, and narrow-width fixtures pass.

## 6. Resource resolution and initial context

- [ ] 6.1 Resolve enabled extension entrypoints and available skills by runtime identity and winning provenance; verification: duplicate, winning-project-scope, and explicit load-failed fixtures produce deduplicated totals and project subsets.
- [ ] 6.2 Publish update coverage as `complete`, `partial`, `offline`, or `failed`; verification: tests show confirmed findings plus an incomplete label for partial coverage and show zero only for complete coverage.
- [ ] 6.3 Share pure `pi-context-view` category, configured-color, and glyph semantics with the header without copying prototype colors; verification: full, partial, compacted, reserve, free, and overridden-color cases pass.
- [ ] 6.4 Render the frozen 14 by 1 full-window base initial-context estimate from static loaded startup inputs without synthetic hooks or turns; verification: six-percent reserve allocation, resume exclusion of session messages, unknown capacity, and prompt-footer ownership fixtures pass.
- [ ] 6.5 Prove runtime and header snapshots expose no raw prompt, tool schema, context-file content, skill content, message, or credential; verification: snapshot redaction tests pass.

## 7. Rendering and integration validation

- [ ] 7.1 Implement width-aware section degradation and Pi theme updates without data probes; verification: representative wide and narrow normative fixtures preserve borders, readable output, visible status semantics, timestamps, and stale markers.
- [ ] 7.2 Run neighboring extension tests and `devenv test`, then resolve any regression without weakening existing checks; verification: targeted tests and the relevant `devenv test` suite pass.
- [ ] 7.3 Validate the patched Pi package through the NixOS repository's existing Pi package checks and normative startup fixtures; verification: compare baseline, linked-worktree, and integration-problem output with `references/start-screen-concepts.html` only where its layout and style do not conflict with the normative fixtures.
