## Context

Pi's startup screen owns the resource list, transcript, editor, and prompt footer. The new header replaces only its header area. It needs passive data owned by the Pi runtime and local extensions without crossing their side-effect or trust boundaries.

The maintained Pi 0.85.1 Nix patch lives in `/home/fbb/nixos/modules/development/ai/pi/` and is guarded by its existing version assertion. The installed local TypeScript SDK is currently 0.84.4 while the runtime is 0.85.1. Align the SDK and runtime before coding against the patched API. The approved visual reference at `references/start-screen-concepts.html` guides layout only and is not normative.

## Goals / Non-Goals

**Goals:**

- Show a compact, session-scoped startup view from authoritative passive data.
- Preserve existing startup-screen behavior and make freshness, failure, and unchecked state visible.
- Make owner ordering and freshness deterministic across reloads and replacement.
- Bound candidate inspection and sanitize all externally derived display fields before styling or measurement.
- Keep each source owner responsible for its operations and trust checks.

**Non-Goals:**

- No credential refresh, usage fetch, formatter run, LSP start, recursive workspace scan, direnv approval or evaluation, Neovim connection, model turn, polling, or owner-triggered fetch from the header.
- No raw prompt, context, command argument, environment value, raw error, private ID, filesystem inference, or mutation of files, buffers, selections, or tools.
- No replacement of the resource listing, transcript, editor, prompt footer, auth resolver, or integration owners.
- No persisted data migration or new dependency.

## Decisions

### Gate `setHeader` on a versioned runtime capability

The Nix patch exposes the explicit capability identifier `pi.startupSnapshot` and schema version `1`, with typed declarations at `.pi/agent/lib/pi-coding-agent-startup.d.ts`. The header checks both before calling `setHeader`. Pi version is not sufficient evidence of capability because a partial deployment can run an unpatched package at the pinned version.

Deploy the runtime patch and aligned declarations before enabling header registration. If the capability is absent or its schema is incompatible, the extension does not call `setHeader`, leaves Pi's built-in header intact, and emits one nonfatal incompatibility notice through Pi's supported UI. The existing Nix 0.85.1 version assertion remains. Tests cover unpatched 0.85.1, 0.84.4, and an incompatible future schema.

### Order snapshots by session, generation, owner, and revision

Every runtime snapshot and owner request, reply, and change carries `sessionId`, `generationId`, `ownerId`, and a monotonically increasing `ownerRevision`. `generationId` changes when Pi reloads or replaces the header owner. The header subscribes before issuing its initial request, then accepts only the active session and generation. For each owner, it rejects revisions older than the displayed revision.

The generation and revision checks make delayed replies harmless, including A to B to A owner replacement. Disposal stops subscriptions and local deadline timers. A header replacement starts a new generation and cannot accept a reply from its predecessor.

### Publish structured, passive owner snapshots

Owners publish immutable snapshots through Pi's request, reply, and change pattern. Publishers emit allowlisted structured fields, not reused free-form status strings. Display values derived from profiles, providers, windows, servers, candidates, paths, diagnostics, or next-step labels are sanitized before styling or width measurement: remove C0 and C1 controls, ESC, OSC, CSI, and line separators, then apply per-field length bounds. Snapshots never contain command arguments, environment values, raw errors, or private IDs.

Owners use `unavailable`, `collecting`, `ready`, `degraded`, and `disposed` state. Freshness is explicit: snapshots carry observed-at, stale-at, and expiry deadlines separately. Owners schedule one-shot local deadline notifications. They do not poll or fetch. After suspend or a clock change, they recompute from absolute timestamps. Deadline transitions only republish state; they do not refresh credentials, usage, or credits.

### Keep auth observations in memory and support legacy cache safely

Richer auth data flows in memory from owner observations. Provider windows retain stable identity plus independent observed-at, stale-at, allowance-reset, and banked-expiry timestamps. Expiry never means replenishment, and zero banked resets suppress the expiry field and deadline.

The existing legacy cache remains readable without a schema migration. It is metadata-unavailable for window identity and absolute reset data. The header never reconstructs missing fields or fetches them. Tests cover legacy-cache rendering and a downgrade path that continues to read the old cache.

### Extract bounded candidate matching

Candidate matching is pure and deterministic. Inspect only the canonical startup cwd and its ancestor chain up to the canonical repository or worktree root. Cap inspection at 32 ancestor levels, 256 configured entries, 16 root markers per entry, and 64 displayed unique candidates per kind. Report explicit overflow or incomplete state at each limit. Do not scan recursively.

A candidate is a configured formatter or LSP that could apply when a matching file is used and whose root-marker condition matches the inspected ancestor chain. Unconditional formatter commands remain configured candidates. Display order preserves existing first-available formatter execution order. Candidate status does not assert executable availability. Trust-disabled, invalid settings, incomplete or limit-reached, none, and unavailable remain distinct.

A `.git` file does not by itself link a submodule or separate-gitdir checkout to a worktree. Resolve common-dir and worktree metadata before reporting linked-worktree identity.

### Count resolved resources and qualify update coverage

Extension totals count resolved enabled extension entrypoints, deduplicated by runtime identity and winning provenance. Load failures are counted and displayed separately. The project subset is the deduplicated entries whose winning `sourceInfo` scope is project. Skills use the same resolution and winning-provenance rule for available resources.

The update snapshot carries `complete`, `partial`, `offline`, or `failed` coverage. It counts each updateable enabled package once and excludes pinned, local, and disabled packages. `partial` retains confirmed findings and visibly says the check is incomplete. Zero updates is shown only for complete coverage. Updates stay adjacent to extensions.

### Define visible integration and context semantics

The TUI has no established assistive-text channel, so visible symbols are normative. `nvim`, `direnv`, and `lsp` use `✓`, `!`, or `?` with source-specific visible labels. `lsp ✓` means the owner confirmed an applicable server is ready for the explicitly observed document set. It does not mean zero diagnostics or a clean workspace. Fresh startup without prior owner evidence renders `lsp ?`. Problem detail may omit a next step when the owner has no verified remedy.

The context label is a frozen base initial-context estimate. It excludes session messages and dynamic per-turn injections because the existing prompt footer owns current session usage. The runtime captures sanitized category token totals from static loaded startup inputs without synthetic before-agent hooks or turns. Unknown capacity is unavailable.

The strip remains 14 by 1 cells over the full context scale and uses the configured category colors and glyph semantics. At six percent usage, remaining cells split between configured auto-compact reserve and free capacity using the configured reservation and rounding rules. They are not all free. Resumed sessions still show this base estimate.

### Render through `setHeader` only after the handshake

After the capability check, one stable view model transforms published snapshots into Pi's active theme. Render and theme invalidation do not probe. The renderer preserves Pi's built-in loaded-resource listing outside the header, adapts to width, and degrades sections into readable rows without broken borders. It shows freshness and partial or unavailable states without suppressing unrelated sections.

### Test boundaries and fixtures

Tests cover the capability handshake, immutable runtime snapshots, schema compatibility, event ordering, owner disposal, deadline transitions, structured-field sanitization, candidate caps, auth cache compatibility, resource resolution, visible TUI semantics, context reserve allocation, width-aware rendering, and no-side-effect spies. Normative fixtures define expected content and state. Visual comparison against `references/start-screen-concepts.html` is limited to nonconflicting layout and style choices.

## Risks / Trade-offs

- [The cross-repository Pi patch drifts from its pinned source] → Keep the patch narrow, retain the version assertion and capability check, and run patch-apply and snapshot tests on each Pi update.
- [A runtime patch and types deploy only partially] → Require `pi.startupSnapshot` schema version `1` before `setHeader`; retain the built-in header and show one nonfatal notice otherwise.
- [Delayed replies overwrite newer state] → Require matching session and generation plus nondecreasing owner revision.
- [External labels control terminal output] → Restrict publishers to structured allowlisted fields and sanitize before styling or measurement.
- [Candidate inspection becomes expensive or misleading] → Use canonical bounded ancestor matching, explicit incomplete states, and no executable claim.
- [Cached auth state loses metadata] → Read legacy cache without migration, render unavailable metadata, and never reconstruct or fetch it.
- [Deadline handling creates hidden activity] → Use one-shot local notifications that only change freshness state.
- [Package update data is incomplete] → Keep confirmed findings, label partial coverage, and reserve zero for complete coverage.

## Migration Plan

1. Align the local TypeScript SDK with Pi 0.85.1. Add the guarded runtime patch, `.pi/agent/lib/pi-coding-agent-startup.d.ts`, capability handshake, schema tests, and Nix assertion validation.
2. Add passive, revisioned publisher snapshots for runtime resources, auth, Neovim, direnv, LSP, formatter candidates, and `pi-context-view` totals. Add bounded matching, sanitization, deadline, cache, and resolution tests.
3. Enable header registration only after the handshake. Validate normative fixtures, no-side-effect behavior, width rendering, and nonconflicting visual comparison.

Rollback first disables header registration and publisher registrations, leaving Pi's built-in header. Then remove the runtime patch and aligned declarations. No persisted data requires migration or cleanup; legacy cache remains readable without migration while the feature is deployed.
