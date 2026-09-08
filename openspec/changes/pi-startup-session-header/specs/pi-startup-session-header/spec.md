## Purpose

Define Pi's session-scoped startup header so an interactive session exposes workspace, passive integration, auth, initial-context, resource, and startup information without changing the rest of the startup screen or starting work.

## ADDED Requirements

### Requirement: The header is extension-first and optional integrations are isolated

The header SHALL register through Pi's public `setHeader` extension API without requiring another extension or a Pi runtime patch. It SHALL obtain data through public extension APIs and structured extension-owned publishers whenever those interfaces can provide the required facts accurately and passively. A Pi runtime patch MAY expose only runtime-owned facts unavailable through those APIs. The header MUST verify any optional runtime capability identifier and schema version before consuming it. An absent or incompatible capability or optional extension MUST omit only its owned output without blocking header registration, emitting an incompatibility notice, or suppressing unrelated sections. If a runtime patch is added, the existing Nix Pi version assertion SHALL remain in force.

#### Scenario: No runtime patch is installed

- **WHEN** Pi supports `setHeader` but exposes no optional startup runtime capability
- **THEN** the extension installs the session header and omits only fields that require that capability

#### Scenario: An optional publisher is absent

- **WHEN** an optional extension publisher is not installed
- **THEN** the header omits that publisher's output without a placeholder or warning and continues rendering unrelated sections

#### Scenario: An optional runtime schema is incompatible

- **WHEN** Pi exposes an optional startup capability with an unsupported schema version
- **THEN** the header ignores that capability, omits its fields, and continues rendering without an incompatibility notice

### Requirement: The header replaces only the startup header

The system SHALL replace Pi's startup header with one session header when the extension initializes in a supported interactive UI. It MUST preserve Pi's loaded-resource listing, transcript, editor, and prompt footer, and MUST NOT render a second model or thinking display.

#### Scenario: Ordinary startup

- **WHEN** Pi reaches its initial interactive screen in an ordinary Git workspace
- **THEN** the session header appears above the existing resource listing and the existing transcript, editor, and prompt footer remain in their normal places

### Requirement: Published snapshots are authoritative, ordered, and session-scoped

Every present owner snapshot, request, reply, and change SHALL carry `sessionId`, `generationId`, `ownerId`, and a monotonically increasing `ownerRevision`. This requirement includes data consumed from an optional runtime capability. `generationId` MUST change on reload or header-owner replacement. The header MUST subscribe before its initial request, accept only the active session and generation, and reject a revision older than the revision already displayed for that owner. It SHALL dispose subscriptions and local deadline timers when the session or owner changes.

#### Scenario: A reload changes generation

- **WHEN** Pi reloads the header and a reply from the prior generation arrives
- **THEN** the header ignores that reply even when its session ID and owner ID match

#### Scenario: A delayed A to B to A reply arrives

- **WHEN** owner A is replaced by B, A becomes the owner again in a new generation, and the first A instance replies late
- **THEN** the header ignores the late reply and renders only the new-generation A state

#### Scenario: An older revision arrives

- **WHEN** an owner publishes revision 8 after the header displays revision 9 for the active session and generation
- **THEN** the header ignores revision 8

### Requirement: Collection and freshness transitions remain passive

The header SHALL render published data only. It MUST NOT refresh or read raw credentials, fetch usage, start an LSP, run a formatter, approve or evaluate direnv beyond existing owner behavior, open a Neovim channel, create a synthetic model turn, poll, or mutate selection, files, buffers, or tools. Owner snapshots MUST carry independent observed-at, stale-at, and expiry deadlines. Owners SHALL schedule local one-shot deadline notifications and recompute deadlines from absolute timestamps after suspend or a clock change. A deadline transition MUST NOT fetch, refresh, or consume anything.

#### Scenario: An optional owner is absent

- **WHEN** an optional integration owner is not installed
- **THEN** the header omits that owner's output and performs no probe or side effect

#### Scenario: An installed owner has not published

- **WHEN** an installed integration owner has not published a result for the active generation
- **THEN** the header reports that owner's field as unavailable or unchecked as applicable and performs no probe or side effect

#### Scenario: A session is idle past a deadline

- **WHEN** an owner reaches its stale-at or expiry deadline while the session is idle
- **THEN** it publishes the corresponding freshness transition without polling, fetching usage, refreshing credentials, or consuming credits

### Requirement: All external display fields are structured and sanitized

Publishers SHALL emit structured allowlisted fields and MUST NOT reuse free-form status strings. Before styling or width measurement, the header MUST sanitize every externally derived profile, provider, window, server, candidate, path, diagnostic, and next-step label. Sanitization MUST remove C0 and C1 controls, ESC, OSC, CSI, and line separators and apply field-length bounds. Snapshots and rendered output MUST NOT include command arguments, environment values, raw errors, or private IDs.

#### Scenario: A label contains terminal controls

- **WHEN** an externally derived provider label contains OSC, CSI, C0, C1, ESC, or line-separator characters
- **THEN** the displayed label contains none of those characters before styling or width measurement

#### Scenario: A diagnostic contains a canary secret

- **WHEN** an owner receives a raw diagnostic containing a canary secret
- **THEN** the publisher omits the raw diagnostic and the header does not render the canary secret

### Requirement: Workspace identity is accurate

The header SHALL show the current branch for a Git workspace. It MUST show a path only for a linked worktree, identify detached HEAD explicitly, omit Git identity for a confirmed non-Git directory, and report inspection failure as unavailable rather than non-Git. It SHALL respect project trust rules. A `.git` file alone MUST NOT identify a submodule or separate-gitdir checkout as linked; linked-worktree status requires common-dir and worktree metadata.

#### Scenario: Ordinary Git workspace startup

- **WHEN** Pi starts in an ordinary Git workspace on branch `main`
- **THEN** the header shows `main` and no linked-worktree path

#### Scenario: Detached HEAD workspace

- **WHEN** Pi starts in a Git workspace with detached HEAD
- **THEN** the header explicitly identifies the workspace as detached HEAD

#### Scenario: Confirmed non-Git workspace

- **WHEN** Pi confirms the startup directory is not a Git workspace
- **THEN** the header omits branch and worktree identity

#### Scenario: Linked worktree startup

- **WHEN** Pi starts in a linked Git worktree with confirming common-dir and worktree metadata
- **THEN** the header shows its branch and linked-worktree path

#### Scenario: A submodule has a `.git` file

- **WHEN** the startup directory is a submodule or separate-gitdir checkout with a `.git` file but no confirming linked-worktree metadata
- **THEN** the header does not claim linked-worktree identity solely from the `.git` file

#### Scenario: Workspace inspection is indeterminate

- **WHEN** workspace inspection fails
- **THEN** the header marks workspace identity unavailable and does not claim the directory is non-Git

### Requirement: Integration status has visible evidence semantics

The header SHALL render lowercase `nvim`, `direnv`, and `lsp` statuses using visible `✓`, `!`, or `?` semantics. Neovim MUST be omitted for standalone Pi. `nvim ✓` means its owner confirmed an existing channel bound to the matching canonical workspace. `direnv ✓` means its owner confirmed the environment was successfully applied to its owned Bash tool. `lsp ✓` means the owner confirmed an applicable server is ready for the explicitly observed document set. It MUST NOT mean zero diagnostics or workspace-wide cleanliness. Fresh startup without prior owner evidence MUST show `lsp ?`. A problem detail MAY omit a next step when its owner has no verified remedy.

#### Scenario: Standalone Pi has no Neovim integration

- **WHEN** Pi starts without a Neovim integration owner
- **THEN** the header omits `nvim`

#### Scenario: Healthy Neovim and direnv integrations

- **WHEN** the Neovim owner confirms an existing channel bound to the canonical startup workspace and the direnv owner confirms the environment was applied to its owned Bash tool
- **THEN** the header displays `nvim ✓` and `direnv ✓`

#### Scenario: LSP is ready for observed documents

- **WHEN** the owner confirms an applicable language server is ready for the observed documents `src/main.ts` and `src/lib.ts`
- **THEN** the header displays `lsp ✓` with visible meaning limited to those observed documents

#### Scenario: LSP has no prior owner evidence

- **WHEN** a fresh startup has no LSP owner evidence
- **THEN** the header displays `lsp ?` and does not infer clean workspace state

#### Scenario: An integration problem has no remedy

- **WHEN** an owner reports a problem without a verified next step
- **THEN** the header displays the problem detail without inventing a next step

### Requirement: Candidate lists use bounded applicability matching

The header SHALL list formatter and LSP candidates using existing settings, file-language mappings, and root-marker rules. It MUST inspect only the canonical startup cwd and its ancestor chain to the canonical repository or worktree root, with caps of 32 ancestor levels, 256 configured entries, 16 markers per entry, and 64 displayed unique candidates per kind. It MUST NOT scan recursively, execute, spawn, or claim executable availability. A candidate is a configured formatter or LSP that could apply when a matching file is used and whose root-marker condition matches that chain. Unconditional formatter commands remain configured candidates, and displayed formatter order MUST preserve first-available execution order. Trust-disabled, invalid settings, incomplete or limit-reached, none, and unavailable are distinct.

#### Scenario: Unconditional formatter and root-marked LSP apply

- **WHEN** a configured unconditional formatter and a configured LSP whose root marker matches the ancestor chain could apply to matching files
- **THEN** both are displayed candidates and formatter order preserves first-available execution order without asserting executable availability

#### Scenario: Project trust is disabled

- **WHEN** project trust disables candidate settings
- **THEN** the header reports trust-disabled candidate data and does not inspect or execute project candidate configuration

#### Scenario: Candidate inspection reaches a limit

- **WHEN** candidate collection exceeds an ancestor, configured-entry, marker, or displayed-candidate cap
- **THEN** the header reports incomplete or limit-reached candidate data rather than none

#### Scenario: Candidate rules are invalid

- **WHEN** candidate settings are invalid
- **THEN** the header reports invalid settings rather than none or unavailable

### Requirement: Auth status preserves observation and cache limits

The header SHALL show the effective repository and session auth chain in resolver order, with actual active profile distinct from next candidate. `[next]` identifies the next resolver candidate and MUST NOT promise a successful switch. Each profile SHALL show its method, provider-window label, remaining allowance, and reset when reported. Allowances for separate provider windows MUST NOT be summed. An unreported allowance MUST NOT be displayed as zero or unlimited. In-memory owner observations SHALL carry stable provider-window identity and separate observed-at, stale-at, allowance-reset, banked-reset count, and banked-expiry deadlines. Expiry MUST NOT imply replenishment. Zero banked resets MUST suppress expiry. The existing legacy cache MUST remain readable without migration, reconstruction, or fetch; its missing window identity and absolute reset data SHALL display as metadata-unavailable.

#### Scenario: Auth chain has active and next profiles

- **WHEN** the resolver reports active profile `work` before `[next] personal`, each with a reported method, provider-window label, remaining allowance, and reset, and reports an independent banked-reset count and expiry for `work`
- **THEN** the header displays `work` and `[next] personal` in resolver order with their reported metadata, displays the independent banked-reset count and expiry for `work`, does not sum allowances, and does not promise that `[next] personal` can switch successfully

#### Scenario: Legacy auth cache is read

- **WHEN** the owner reads an existing legacy auth cache without window identity or absolute reset metadata
- **THEN** the header retains the cache's supported selection information and renders window identity and absolute reset metadata as unavailable without fetching or reconstructing them

#### Scenario: Downgrade reads the old cache

- **WHEN** a deployment is downgraded after richer in-memory observations were used
- **THEN** the existing legacy cache remains readable without a persisted schema migration

#### Scenario: Banked resets are zero

- **WHEN** a provider reports zero banked resets
- **THEN** the header omits banked-reset expiry and no expiry deadline is scheduled

### Requirement: Resource counts use resolved provenance and coverage

The header SHALL count resolved enabled extension entrypoints, deduplicated by runtime identity and winning provenance. It MUST display explicit load-failed state separately. The project subset SHALL be deduplicated entries with winning `sourceInfo` scope project and SHALL appear parenthetically only when nonzero. Available skills SHALL be deduplicated after resolution with winning provenance. An `available` skill count MUST NOT imply a skill is loaded or used. Updates MUST remain adjacent to extensions, count each updateable enabled package once, and exclude pinned, local, and disabled packages. Update snapshots SHALL carry coverage `complete`, `partial`, `offline`, or `failed`. Partial coverage MUST retain confirmed findings and visibly state that the check is incomplete. Zero updates MUST appear only for complete coverage.

#### Scenario: Zero project subset

- **WHEN** resolved resource totals contain no entries with winning `sourceInfo` scope project
- **THEN** the header displays totals without `(0 project)`

#### Scenario: Update coverage is partial

- **WHEN** an update check confirms two updateable enabled packages but cannot cover all sources
- **THEN** the header shows two updates adjacent to extensions and visibly says the check is incomplete

#### Scenario: Complete coverage finds no updates

- **WHEN** complete update coverage finds no updateable enabled package
- **THEN** the header shows zero updates adjacent to extensions

### Requirement: Initial context is a frozen base estimate

The header SHALL render a compact 14 by 1 initial-context strip using `pi-context-view` category semantics and configured colors. It MUST use `■` for full cells, `◧` for partial cells, `▦` for compacted categories when relevant, `⛝` for configured auto-compact reserve, and `⛶` for free capacity. The estimate MUST include static loaded startup inputs only and exclude session messages and dynamic per-turn injections. The implementation SHALL first use a structured `pi-context-view` extension publisher. If public extension APIs cannot provide an accurate passive startup estimate, a minimal runtime capability MAY provide sanitized category token totals and capacity only. Neither path may create synthetic before-agent hooks or turns. If neither source is present, the header MUST omit the strip. Unknown capacity from a present source MUST render unavailable. The existing prompt footer owns current session usage.

#### Scenario: Six percent estimate includes reserve

- **WHEN** static startup totals estimate six percent of a known full context window with a configured auto-compact reserve
- **THEN** the 14-cell strip allocates approximately six percent to categories and splits remaining cells between reserve and free capacity using configured reservation and rounding rules

#### Scenario: A resumed session starts

- **WHEN** Pi resumes a session with existing messages
- **THEN** the header shows the frozen base initial-context estimate and does not add resumed session messages to it

#### Scenario: Capacity is unknown

- **WHEN** a present context source cannot provide full context capacity
- **THEN** the initial-context strip reports unavailable and does not render every cell as free

### Requirement: Startup timing uses the installed startup-time package

The header SHALL consume the current `startup-time` custom session entry written by the installed `@liborw/pi-startup-time` extension. The displayed duration MUST retain that package's semantics: elapsed time from package module initialization, when it captures `bootAt` with `process.hrtime.bigint()`, to execution of its `session_start` handler. The header MUST NOT describe the value as Pi process startup time or time to first interactive render. It SHALL accept only a newly appended entry for the current `startup` or `reload` dispatch with a finite nonnegative `elapsedMs` and finite timestamp, then freeze the value for the active generation. It MUST NOT run an independent timer or poll. If the package is absent or no valid current entry is appended, the header MUST omit startup timing without a warning or placeholder.

#### Scenario: Startup timing is measured

- **WHEN** `@liborw/pi-startup-time` appends a valid measurement during the current `session_start` dispatch
- **THEN** the header displays that module-load-to-`session_start` duration and keeps it unchanged for the active generation

#### Scenario: Reload produces a new measurement

- **WHEN** the package appends a valid measurement with reason `reload` for a new header generation
- **THEN** the header replaces the prior generation's startup duration with the new reload duration

#### Scenario: The startup-time publisher is absent

- **WHEN** `@liborw/pi-startup-time` is not installed or appends no valid measurement for the current dispatch
- **THEN** the header omits startup timing, emits no warning or placeholder, and continues rendering unrelated sections

#### Scenario: Only a prior measurement exists

- **WHEN** the session contains a `startup-time` entry from a prior startup or reload but no new entry is appended during the current dispatch
- **THEN** the header does not reuse the prior measurement and omits startup timing

### Requirement: Rendering remains usable across widths and failures

The header SHALL use Pi's baseline visual family and active theme. It SHALL expand only problem details, wrap or degrade sections for terminal width without broken borders, and remain usable in a narrow terminal. Unavailable or degraded fields MUST NOT suppress unrelated sections. Owner timestamps and stale markers MUST remain visible after sanitization. The approved visual reference is `references/start-screen-concepts.html`; it is not a normative contract.

#### Scenario: Narrow terminal

- **WHEN** the terminal is too narrow for the full auth table or header rows
- **THEN** the renderer wraps or degrades the affected presentation without broken borders and preserves readable status information

#### Scenario: Some data is unavailable

- **WHEN** auth updates fail while workspace and integration snapshots are ready
- **THEN** the header shows the auth failure and freshness state while continuing to show workspace and integration sections
