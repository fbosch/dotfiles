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

Nested read-scoped replacement remains disabled by default. The experimental `experimentalReadResultSources` option enables exact-path allowlisting for successful `read` tool results. It replaces the tool output only after image capability is confirmed and leaves plaintext unchanged on preparation failure. Nested replacement is committed independently from ambient system replacement. Real-model parity previously failed even with metadata and a factsheet, so allowlisted sources remain experimental rather than part of the ambient replacement guarantee.

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
- Allowlisted completed `read` results use their exact tool output as the rendered source; unrelated reads remain plaintext.
- Pending replacements are bound to the active model so concurrent title and summary prompts cannot consume them.
- System replacement validates every source before removing plaintext and logs `replacement_mismatch` on failure. OpenCode 1.17.18 converts message attachments before the system hook, so rollback cannot remove an already-converted ambient image from that provider request.
- Rendered artifacts are cached by source content and renderer identity under `~/.cache/opencode/context-images/`.
- Best-effort structured events are written to `~/.local/state/opencode/context-images/events.jsonl` without instruction contents.
- pxpipe loads `runExportCore` in-process when available and falls back to `pxpipe export` when package discovery, import, or library rendering fails.
- Background preload reduces first-request renderer initialization after idle.

## Verified Baseline

Recorded on 2026-07-13 and 2026-07-14:

- 23 Bun tests pass with 60 expectations.
- Strict TypeScript checking passes.
- Bun bundling passes.
- Fallow reports no dead code and no duplication.
- Fallow health is `90 / A` with maintainability `91.5`.
- A fresh `gpt-5.6-sol` OpenCode `1.17.18` process completed wholesale replacement with no replacement mismatch.
- Automatic discovery found the active global, project, and configured instruction files.
- Nested plaintext passed eight real-model policy checks while direct `AGENTS.md` rereads were denied.
- Compaction preservation and text-only model behavior are unit-tested, not provider-level end-to-end tested.
- An experimental `TONE.md` Read-result probe reproduced the nested parity failure: the image path returned two of three requested bullets exactly and invented the third, while the plaintext control returned all three exactly.

See `BENCHMARK.md` for the method and complete results. Current representative means are:

- Message transform, cache hit: `0.305-0.384 ms`.
- Warm in-process pxpipe render: `19.517-20.090 ms`.
- CLI pxpipe render: `397.169-420.940 ms`.
- Immediate cold library use: `610.900-632.611 ms`.
- First library use after background preload: `43.798-46.118 ms`.

## Known Limits

- Semantic equivalence has not been demonstrated for the current ambient image replacement across all active models.
- Experimental Read-result replacement has not recovered the semantic parity that caused nested replacement to be disabled by default.
- Ambient mismatch rollback cannot remove message attachments after OpenCode has converted them for the provider; a pre-conversion system-and-message hook is needed for strict atomic fail-open behavior.
- The current dense single-page layout may save tokens while reducing model comprehension.
- Factsheet extraction needs completeness testing beyond identifiers already observed in runtime probes.
- OpenCode discovery parity is not established for every glob, non-Git directory, symlink, or compatibility-file edge case.
- The in-process pxpipe path depends on an internal package export and has no render timeout.
- Provider-level compaction behavior remains unverified.
- Provider image-token accounting is model-specific; reduced text tokens do not by themselves prove lower total input cost.
