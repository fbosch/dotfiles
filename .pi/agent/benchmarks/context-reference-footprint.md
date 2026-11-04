# Context footprint change

The implementation now ranks archived snapshots before the bounded disk scan,
keeps declaration values and short command output in explicit recall excerpts,
and accepts trusted macOS cache-root aliases. Archive validation, symlink
rejection and disk-read budgets remain enforced.

Retained manifests share their archive root and call-catalogue address. Large
reference-only codemode calls use bounded descriptions and physical line
pointers. Their complete original call strings remain in a validated catalogue,
one call per line. Small calls and required inline content stay inline.
Repeated recovery instructions now live in the recall tool declaration instead
of every placeholder and saved-source pointer. Persisted original manifests and
rolling placeholders remain readable.

## Manifest tokens

These counts use the actual renderer, `tiktoken` 0.14.0 and `o200k_base`, not the
earlier rendering simulation. They measure the cost when a manifest is read,
not an automatic saving on every request.

| Original manifest prefix | Before | After | Saved |
| --- | ---: | ---: | ---: |
| `3cf1c8814` | 26,717 | 6,994 | 73.8% |
| `24b4cb90` | 14,722 | 4,108 | 72.1% |
| `117db1c3` | 73,585 | 43,263 | 41.2% |
| `c2d89618` | 6,584 | 3,054 | 53.6% |
| `f74644bd` | 28,679 | 20,906 | 27.1% |
| Total | 150,287 | 78,325 | 47.9% |

All 164 original codemode calls remained byte-exact. Three manifests also had
available session catalogues for semantic replay. All 443 recovered sources,
including call metadata and reference-only status, matched before and after.
The other two manifests received token and exact-call checks only.

## Agent and retrieval tokens

The six factual agent trials answered 42/42 questions both before and after.
Provider-reported token consumption was:

| Stage | Before | After recall fix, original index | Compact checkpoint |
| --- | ---: | ---: | ---: |
| Answering model | 29,951 | 31,966 | 14,883 |
| Retrieval classifier | 38,589 | 38,597 | 41,683 |
| Combined | 68,540 | 70,563 | 56,566 |

The combined reduction is 17.5% against the original baseline and 19.8% against
the post-fix index control. The answering-model reduction alone is 50.3%, but
that excludes retrieval work. Classifier totals here include only the agent's
21 classifier-backed searches. They exclude the 117 standalone classifier
benchmark requests. Both providers reported no cache tokens in these runs.

## Recall checks and limits

- Seven selected older facts across three real sessions improved from 0/7 to
  7/7, individually and in batches. They still passed after the actual compact
  archives were added to read-only branch overlays.
- Hosted answerable-passage retrieval stayed at 48/48. Unanswerable-query
  abstention varied across runs. The baseline was 18/27; final index and compact
  runs scored 15/27 and 19/27. These small samples do not establish equivalence.
- An added exact-argument agent probe scored 11/12 across two final-code blocks.
  The later block scored 6/6. Both blocks are counted, including the earlier
  incomplete answer. This added probe has no paired pre-change agent baseline.
- An early draft incorrectly decoded argument strings as stdout and clipped
  their code. A regression test now requires serialized call arguments to remain
  literal. Exact reads in the agent probe use catalogue validation and shared
  tool budgets. Failed reads direct the agent back to recall instead of guessing.

These trials use an autonomous tool loop, not the complete Pi lifecycle. Exact
archive preservation does not guarantee that a model copies every answer
correctly. No original recorded session or source archive was modified.

## Reproduce

Keep the private inputs and original session archives. Use fresh output
directories. From the repository root:

1. Rebuild the compact manifests and check recorded recall:

   ```bash
   bun run --cwd .pi/agent benchmarks/context-reference-footprint.ts "$PWD/.pi/agent/cache/context-reference-footprint-inputs.json" "$PWD/.pi/agent/cache/context-reference-footprint-rerun" "$PWD/.pi/agent/cache/context-recall-baseline-local/recorded-probes.json"
   ```

2. Run the factual compact-checkpoint agent trials:

   ```bash
   bun run --cwd .pi/agent benchmarks/context-recall-baseline.ts --output "$PWD/.pi/agent/cache/context-recall-rerun-checkpoint" --live --agent --agent-memory checkpoint --model vercel-ai-gateway/openai/gpt-4.1-mini --repeats 3
   ```

3. Run the exact-argument agent trials:

   ```bash
   bun run --cwd .pi/agent benchmarks/context-recall-baseline.ts --output "$PWD/.pi/agent/cache/context-recall-rerun-arguments" --live --agent --agent-memory arguments --model vercel-ai-gateway/openai/gpt-4.1-mini --repeats 3
   ```

4. Run `devenv test`. The existing baseline task includes the new regression
   tests and the dedicated benchmark TypeScript project.

## Evidence and validation

The private aggregate report is
`../cache/context-reference-footprint-comparison.json`. It records full source
paths and the individual result directories. The pre-change report and rerun
instructions remain in [the baseline document](context-recall-baseline.md).

The scoped text, metadata, security and benchmark checks passed 277 tests.
TypeScript passed against the installed Pi 1.5.0 runtime. Image validation is
incomplete: 35 tests fail because `/run/current-system/sw/bin/magick` is absent.
`devenv test` remains blocked before tests by its existing home-directory creation
error. No dependency or lockfile changes were made.
