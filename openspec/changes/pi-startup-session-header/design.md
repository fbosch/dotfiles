## Context

Pi's startup screen owns the resource list, transcript, editor, and prompt footer. The new header replaces only its header area. It needs passive data owned by the Pi runtime and local extensions without crossing their side-effect or trust boundaries.

The header and its publishers belong in `.pi/agent/extensions/`. If a required fact is not available through the public extension API, a narrow Pi 0.85.1 Nix patch may expose only that fact through an optional typed, read-only capability. The patch remains guarded by the existing version assertion in `/home/fbb/nixos/modules/development/ai/pi/`. The approved visual reference at `references/start-screen-concepts.html` guides layout only and is not normative.

## Goals / Non-Goals

**Goals:**

- Keep the implementation extension-first and restrict any Pi patch to runtime-owned facts that public extension APIs cannot provide.
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

## Source Ownership Audit

| Header data | Preferred owner | Runtime patch |
| --- | --- | --- |
| Git branch and linked-worktree identity | Header extension using bounded, read-only Git metadata inspection | No |
| Neovim, direnv, and LSP status | Existing local integration extensions | No |
| Formatter and LSP candidates | Existing formatter and LSP extensions using bounded config matching | No |
| Auth chain, windows, and deadlines | Existing auth-profiles extension | No |
| Startup duration | Installed `@liborw/pi-startup-time` custom entry | No |
| Extension and skill totals, project subsets, and extension load failures | Pi resource loader | Minimal aggregate only |
| Frozen static initial-context categories, capacity, and reserve | `pi-context-view` semantics over runtime-owned startup inputs | Minimal aggregate only when public extension data is insufficient |
| Package updates | Optional extension owner with an already completed check | No; omit when no owner has results |

`ResourceLoader`, resolved load errors, startup `BuildSystemPromptOptions`, and compaction reserve are not available on the public `ExtensionAPI` or the `ExtensionContext` passed to `session_start`. The minimal runtime capability therefore publishes numeric resource and context aggregates only. It excludes startup timing, workspace inspection, integration state, auth state, candidate matching, update checks, raw paths, prompts, context files, skill content, tool schemas, messages, credentials, and errors.

## Decisions

### Prefer extension APIs and gate only optional runtime data

The header registers through Pi's public `setHeader` extension API without depending on another extension or a runtime patch. Local integration owners publish through extension-owned structured interfaces. The header detects each optional publisher independently. If a publisher is absent, it omits that publisher's output and continues rendering unrelated sections.

A runtime patch is allowed only for a required runtime-owned fact that cannot be obtained accurately and passively through public extension APIs. Such a patch exposes a narrow capability with an explicit identifier and schema version plus aligned declarations in `.pi/agent/lib/`. The header checks that handshake before consuming the capability, but capability absence or incompatibility does not block `setHeader`; it only omits the runtime-backed fields. The existing Pi version assertion remains. Tests cover no patch, a compatible patch, and an incompatible schema.

### Order snapshots by session, generation, owner, and revision

Every present owner snapshot, request, reply, and change carries `sessionId`, `generationId`, `ownerId`, and a monotonically increasing `ownerRevision`. This includes data from an optional runtime capability. `generationId` changes when Pi reloads or replaces the header owner. The header subscribes before issuing its initial request, then accepts only the active session and generation. For each owner, it rejects revisions older than the displayed revision.

The generation and revision checks make delayed replies harmless, including A to B to A owner replacement. Disposal stops subscriptions and local deadline timers. A header replacement starts a new generation and cannot accept a reply from its predecessor.

### Publish structured, passive owner snapshots

Owners publish immutable snapshots through Pi's request, reply, and change pattern. Publishers emit allowlisted structured fields, not reused free-form status strings. Display values derived from profiles, providers, windows, servers, candidates, paths, diagnostics, or next-step labels are sanitized before styling or width measurement: remove C0 and C1 controls, ESC, OSC, CSI, and line separators, then apply per-field length bounds. Snapshots never contain command arguments, environment values, raw errors, or private IDs.

When an optional owner is installed, it uses `unavailable`, `collecting`, `ready`, `degraded`, and `disposed` state. An absent owner has no row or placeholder. Freshness is explicit: snapshots carry observed-at, stale-at, and expiry deadlines separately. Owners schedule one-shot local deadline notifications. They do not poll or fetch. After suspend or a clock change, they recompute from absolute timestamps. Deadline transitions only republish state; they do not refresh credentials, usage, or credits.

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

### Reuse the installed startup-time measurement

The installed `@liborw/pi-startup-time` package owns startup timing. It captures `bootAt` with `process.hrtime.bigint()` when the extension module is initialized and appends a `startup-time` custom session entry from its `session_start` handler. Its duration therefore means package module load to that handler. It does not mean Pi process start or first interactive render.

A passive header adapter records the prior entry before the current `session_start` dispatch, then performs one deferred read after dispatch so the package can append its current measurement regardless of handler order. The adapter accepts only a newly appended entry with a finite nonnegative `elapsedMs`, a finite timestamp, and reason `startup` or `reload`. It wraps the accepted value in the active session, generation, owner, and revision envelope. A previous session or generation measurement is never reused.

The header freezes the accepted duration for the active generation. A reload may replace it with the package's new `reload` measurement. When the package is absent, does not append a current entry, or writes invalid data, the header omits startup timing and continues rendering unrelated sections. It does not run a second timer or add timing to the Pi runtime capability.

### Define visible integration and context semantics

The TUI has no established assistive-text channel, so visible symbols are normative. `nvim`, `direnv`, and `lsp` use `✓`, `!`, or `?` with source-specific visible labels. `lsp ✓` means the owner confirmed an applicable server is ready for the explicitly observed document set. It does not mean zero diagnostics or a clean workspace. Fresh startup without prior owner evidence renders `lsp ?`. Problem detail may omit a next step when the owner has no verified remedy.

The context label is a frozen base initial-context estimate. It excludes session messages and dynamic per-turn injections because the existing prompt footer owns current session usage. The runtime captures sanitized category token totals from static loaded startup inputs without synthetic before-agent hooks or turns. Unknown capacity is unavailable.

The strip remains 14 by 1 cells over the full context scale and uses the configured category colors and glyph semantics. At six percent usage, remaining cells split between configured auto-compact reserve and free capacity using the configured reservation and rounding rules. They are not all free. Resumed sessions still show this base estimate.

### Render through `setHeader` with independently optional data

One stable view model transforms available owner snapshots into Pi's active theme. Render and theme invalidation do not probe. The renderer preserves Pi's built-in loaded-resource listing outside the header, adapts to width, and degrades sections into readable rows without broken borders. It omits absent optional-owner sections and shows freshness or degraded states for owners that are present without suppressing unrelated sections.

### Test boundaries and fixtures

Tests cover optional capability handshakes, immutable owner snapshots, schema compatibility, absent-publisher omission, event ordering, owner disposal, startup-time entry ordering and validation, deadline transitions, structured-field sanitization, candidate caps, auth cache compatibility, resource resolution, visible TUI semantics, context reserve allocation, width-aware rendering, and no-side-effect spies. Normative fixtures define expected content and state. Visual comparison against `references/start-screen-concepts.html` is limited to nonconflicting layout and style choices.

## Risks / Trade-offs

- [A required runtime-only fact expands the cross-repository Pi patch] → Audit public extension APIs first, expose only the missing aggregate, retain the version assertion and capability check, and run patch-apply tests on each Pi update.
- [A runtime capability or optional extension is absent or incompatible] → Omit only its fields. Keep the header and unrelated sections active without an incompatibility notice.
- [Delayed replies overwrite newer state] → Require matching session and generation plus nondecreasing owner revision.
- [External labels control terminal output] → Restrict publishers to structured allowlisted fields and sanitize before styling or measurement.
- [Candidate inspection becomes expensive or misleading] → Use canonical bounded ancestor matching, explicit incomplete states, and no executable claim.
- [Cached auth state loses metadata] → Read legacy cache without migration, render unavailable metadata, and never reconstruct or fetch it.
- [Deadline handling creates hidden activity] → Use one-shot local notifications that only change freshness state.
- [Package update data is incomplete] → Keep confirmed findings, label partial coverage, and reserve zero for complete coverage.
- [A prior startup-time entry is mistaken for the current run] → Record the previous entry before dispatch and accept only a newly appended, valid measurement after the current `session_start` dispatch.

## Migration Plan

1. Implement the header, structured owner contracts, and optional publisher adapters through public extension APIs. Integrate the installed `@liborw/pi-startup-time` entry and test absent publishers.
2. Audit remaining runtime-owned requirements. Add a guarded, typed Pi capability only for facts that cannot be obtained accurately and passively from an extension, then validate its version guard and omission fallback.
3. Enable header registration independently of optional publishers. Validate normative fixtures, no-side-effect behavior, width rendering, and nonconflicting visual comparison.

Rollback disables the header extension and publisher registrations, leaving Pi's built-in header. If a minimal runtime capability was added, remove its patch and aligned declarations afterward. No persisted data requires migration or cleanup; legacy auth cache and `@liborw/pi-startup-time` entries remain readable by their existing owners.
