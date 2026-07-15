# Context Images

## Purpose

This plugin reduces prompt-token use by replacing instruction text wholesale with PNG pages rendered by pxpipe. The image payload must provide the same context and produce the same behavior as the plaintext source.

Images are not supplementary context. A successful transformation removes the corresponding plaintext. Sending both defeats the token-reduction goal.

## Replacement Contract

- For an image-capable model, attach every rendered page and the precision factsheet before removing source text.
- Replace all matched ambient instruction text atomically. Partial replacement is a failure.
- If discovery, rendering, attachment, or source matching fails, retain the original plaintext.
- If the model declares `capabilities.input.image === false`, retain the original plaintext.
- During compaction, retain plaintext rather than injecting image context into the compaction request.
- Never send images and their source text together as duplicate or supplementary context.
- Treat paths, commands, identifiers, hashes, versions, flags, environment variables, glob patterns, key chords, casing-sensitive names, and quoted values as precision-critical factsheet content.

Nested read-result replacement remains disabled by default. The `imageReadResults.paths` option enables exact-path allowlisting, `imageReadResults.filenames` enables case-sensitive basename matching, and `imageReadResults.referenceContents` matches files read beneath OpenCode's materialized reference roots. The `scopedInstructions` option enables lazy replacement of `AGENTS.md` files discovered through OpenCode's Read metadata. Both paths replace tool output only after image capability is confirmed and leave plaintext unchanged on preparation failure. Nested replacement is committed independently from ambient system replacement. Real-model parity previously failed even with metadata and a factsheet, so these options remain higher-risk than the ambient replacement guarantee.

## Source Discovery

Sources are discovered automatically rather than configured through a plugin-specific `sources` option:

- Global `${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-~/.config}/opencode}/AGENTS.md`.
- Project `AGENTS.md` files found toward the worktree root, or `CLAUDE.md` and then deprecated `CONTEXT.md` as file-family fallbacks.
- Global `~/.config/opencode/AGENTS.md`, or `~/.claude/CLAUDE.md` as a compatibility fallback when enabled.
- Local paths from OpenCode `config.instructions`; URL instructions are excluded.

`OPENCODE_DISABLE_PROJECT_CONFIG=1` and `OPENCODE_DISABLE_PROJECT_CONFIG=true` disable project sources while preserving global and explicitly configured sources.

## Runtime Design

- `experimental.chat.messages.transform` prepares and attaches rendered context to the newest user message.
- `experimental.chat.system.transform` removes matched system text and inserts one authority marker.
- Each ambient instruction file is rendered and cached independently, preserving nested `AGENTS.md` locality and source order. Source-specific pages use names such as `configured-AGENTS.md-1234abcd5678efab-001.png`; allowlisted Read results use names such as `read-TONE.md-1234abcd5678efab-001.png`.
- Both the system marker and package prompt identify ambient images as trusted configured context and instruct the model not to classify them as user-pasted text.
- Allowlisted completed `read` results use their exact tool output as the rendered source; unrelated reads remain plaintext.
- Completed Reads expose newly discovered nested instruction paths through OpenCode's `metadata.loaded`. Their exact `<system-reminder>` blocks are lazily rendered as source-local packages and replaced atomically; cache misses or incomplete packages leave the reminder plaintext.
- Pending replacements are bound to the active model so concurrent title and summary prompts cannot consume them.
- System replacement validates every source before removing plaintext and logs `replacement_mismatch` on failure. OpenCode 1.17.18 converts message attachments before the system hook, so rollback cannot remove an already-converted ambient image from that provider request.
- Rendered artifacts are cached by source content and renderer identity under `~/.cache/opencode/context-images/`.
- The cache root and rendered directories use mode `0700`; generated artifacts use mode `0600` so only the owning user can read instruction images.
- A cache miss in any source retains all ambient plaintext for that call and schedules missing sources behind bounded, deduplicated warming. Two renders may run concurrently and at most 16 may be active or queued; excess keys retry on later transformations. Images are used only after every required cache publication validates.
- An Effect-based render coordinator owns keyed deduplication, the two-render concurrency limit, detached warming, startup timeout, publication validation, failure cleanup, retries, and test draining. Discovery and message transformation remain plain TypeScript.
- Startup blocks for at most one second while warming ambient instructions for the configured default model. Cache hits add about 0.14 ms; slow or failed warming falls back to the normal plaintext-first path.
- Best-effort structured events are written to `~/.local/state/opencode/context-images/events.jsonl` without instruction contents.
- Successful replacements and plaintext fallbacks enqueue content-free estimates for `~/.local/state/opencode/context-images/stats.jsonl` without awaiting filesystem writes in provider hooks. Reports flush the queue before reading. The plugin-defined `/context-images-stats [session|repo|total]` command reports session statistics by default.
- pxpipe loads `runExportCore` in-process when available and falls back to `pxpipe export` when package discovery, import, or library rendering fails.
- Background preload reduces first-request renderer initialization after idle.

## Verified Baseline

Recorded on 2026-07-13 through 2026-07-15:

- 55 Bun tests pass with 161 expectations.
- Strict TypeScript checking passes.
- Bun bundling passes.
- Fallow reports no dead code and no duplication.
- Fallow health is `90 / A` with maintainability `90.8`.
- A fresh `gpt-5.6-sol` OpenCode `1.17.18` process completed wholesale replacement with no replacement mismatch.
- Automatic discovery found the active global, project, and configured instruction files.
- Nested plaintext passed eight real-model policy checks while direct `AGENTS.md` rereads were denied.
- Compaction preservation and text-only model behavior are unit-tested, not provider-level end-to-end tested.
- An experimental `TONE.md` Read-result probe reproduced the nested parity failure: the image path returned two of three requested bullets exactly and invented the third, while the plaintext control returned all three exactly.

See `BENCHMARK.md` for the method and complete results. Current representative means are:

- Message transform, cache hit: `0.319-0.450 ms`.
- Pxpipe cache-miss dispatch: `0.278-0.672 ms`.
- Pxpipe cache ready: `23.664-30.416 ms`.
- Warm in-process pxpipe render: `12.257-14.206 ms`.
- CLI pxpipe render: `296.274-320.345 ms`.
- Immediate cold library use: `427.323-468.667 ms`.
- First library use after background preload: `28.923-38.539 ms` in stable cases.

## Known Limits

- Semantic equivalence has not been demonstrated for the current ambient image replacement across all active models.
- Image parts are still serialized by OpenCode under a user message. The system marker delegates system-level authority, but prompt wording cannot make the provider role literally `system` or `developer`.
- Experimental Read-result replacement has not recovered the semantic parity that caused nested replacement to be disabled by default.
- Ambient mismatch rollback cannot remove message attachments after OpenCode has converted them for the provider; a pre-conversion system-and-message hook is needed for strict atomic fail-open behavior.
- The current dense single-page layout may save tokens while reducing model comprehension.
- Factsheet extraction needs completeness testing beyond identifiers already observed in runtime probes.
- OpenCode discovery parity is not established for every glob, non-Git directory, symlink, or compatibility-file edge case.
- The in-process pxpipe path depends on an internal package export and has no render timeout.
- Background warming is deferred rather than off-thread; CPU-heavy renderer work can still occupy the OpenCode event loop after the plaintext request proceeds.
- Provider-level compaction behavior remains unverified.
- Provider image-token accounting is model-specific; reduced text tokens do not by themselves prove lower total input cost.
