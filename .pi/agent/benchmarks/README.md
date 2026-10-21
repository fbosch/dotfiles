# Pi startup benchmark

This benchmark measures the time from launching Pi to completing interactive
TUI initialization. Pi's `PI_STARTUP_BENCHMARK=1` mode performs the normal
interactive startup and stops the TUI before accepting input or contacting a
model. A benchmark-only extension observes that stop and exits the benchmark
process so long-lived extension resources cannot keep the sample alive.

## Run it

From the repository root:

```bash
just pi-benchmark
```

The default `breakdown` target measures the full setup and two diagnostic
controls. To record only the primary workload:

```bash
just pi-benchmark full
```

The package-local equivalents are:

```bash
bun run --cwd .pi/agent benchmark:startup
bun run --cwd .pi/agent benchmark:startup full
```

Use environment variables to change the sample policy or output path:

```bash
PI_BENCHMARK_WARMUPS=5 \
PI_BENCHMARK_RUNS=20 \
PI_BENCHMARK_TIMEOUT=30s \
PI_BENCHMARK_OUTPUT_DIR=/tmp/pi-startup-baseline \
just pi-benchmark
```

Results default to `$XDG_STATE_HOME/dotfiles/pi-benchmarks/`. When
`XDG_STATE_HOME` is unset, they go to
`~/.local/state/dotfiles/pi-benchmarks/`.

## Scenarios

- `full` is the primary metric. It loads the current Pi settings, packages,
  extensions, skills, prompts, themes, and context.
- `no-extensions` keeps other resources enabled but disables extension
  discovery. Its difference from `full` estimates extension loading and
  initialization cost.
- `minimal-resources` disables extensions, skills, prompt templates, themes,
  and context files. It still uses the current settings and package resolver.
- `pty-control` runs `true` through the same pseudo-terminal launcher. It
  reports launcher overhead and is not subtracted from Pi latency.

Every preflight, warmup, and measured sample is bounded by
`PI_BENCHMARK_TIMEOUT` (default: `30s`). The timeout must be a positive duration
accepted by `timeout` or `gtimeout`.

Use the `full` median from `summary.json` as the baseline. Compare results only
when the metadata schema version, Pi version, machine, target, run counts, and
`setupFingerprint` match the intended before and after states.

## Controlled workload

The benchmark fixes the parts of startup that would otherwise vary between
runs:

- Pi-managed startup network operations and telemetry are disabled.
- Before timing, a separate Pi package-resolution check rejects missing or
  mismatched installed npm/git packages. Installation is forbidden. This check
  deliberately does not use offline resolution, which silently skips missing
  packages and can make an incomplete setup appear faster.
- Credentials, sessions, and live model, MCP, trust, and FFF caches are
  excluded from the initial fixture.
- Project trust is approved explicitly.
- Inherited environment variables are replaced by an allowlist.
- Terminal size is set to 120 columns by 40 rows at the PTY level.
- Terminal capability detection is fixed to no images, hyperlinks, true color,
  or hardware cursor.
- After Pi emits the terminal teardown sequence, a benchmark-only extension
  restores its stdout interception and exits on the next event-loop turn.
- Pi agent source, home resources, mutable agent files, and XDG state roots are
  snapshotted into a private temporary fixture that is deleted on exit.
- Benchmark sources and test directories are excluded because Pi does not load
  them during startup.
- Installed `node_modules` and Pi package directories are linked into the
  fixture, fingerprinted before and after measurement, and protected from
  package updates by offline mode.
- The agent snapshot, project startup resources, and dependency content
  contribute to `setupFingerprint`.
- One preflight startup and explicit warmup runs establish the fixture state
  before Hyperfine measures it.
- The benchmark fails if immutable fixture inputs, linked dependencies, or
  project-level startup resources change during measured runs. All fixture
  symlinks remain immutable, including links at declared output paths.
- Declared runtime outputs are fingerprinted separately before and after
  measurement: the FFF frecency/history `data.mdb` and `lock.mdb` files,
  permission-serving heartbeat JSON files, and Jiti's hash-named `.cjs`/`.mjs`
  files directly under `TMPDIR/jiti`. Their contents can change during normal
  startup. Unexpected files, including other files in those directories, still
  invalidate the benchmark. Runtime outputs remain warmed between samples;
  they are not reset to a seed.

The measurements include Pi's fixed 150 ms terminal-query drain in startup
benchmark mode. They represent credential-free startup with caches warmed
inside the fixture on one machine, not cold boot behavior. `PI_OFFLINE=1` is not
an OS-level network sandbox for third-party extensions. Small differences near
run-to-run variance are inconclusive.

## Artifacts

Each run writes:

- `metadata.json`: runtime, machine, Git, workload, isolation, sample policy,
  declared runtime outputs, and their before/after fingerprints;
- `runtime-before.tsv` and `runtime-after.tsv`: runtime-output paths and content
  hashes, retained even when immutable-input validation fails;
- `summary.json`: median, mean, standard deviation, minimum, and maximum wall
  time in milliseconds;
- `startup.json` and `startup.md`: raw Hyperfine results for Pi scenarios;
- `pty-control.json` and `pty-control.md`: raw launcher-control results.

Artifacts contain no credential contents or copied fixture files.

## TOON heuristic benchmark

Measure the baseline encoder, structural precheck, eager versus deferred lossy-number scanning, and optional tokenizer reference:

```bash
bun run --cwd .pi/agent benchmark:toon
```

The benchmark uses 100 warmups and 1,000 measured runs by default. Override them with `PI_TOON_BENCHMARK_WARMUPS` and `PI_TOON_BENCHMARK_RUNS`.
The tokenizer reference is enabled by setting `PI_TOON_TOKEN_COUNTER_MODULE` to a module exporting `countTokens(text)`.

## Skill-selection hosted benchmark

Run `bun run --cwd .pi/agent benchmark:skill-selection --classifier` for hosted classifier requests. Hosted calls use a 1-second delay by default; override it with `--delay-ms N` (a nonnegative safe integer, including `0` to disable pacing). Transient failures retry the same case before the benchmark advances, using up to 5 total attempts with 2-second exponential backoff capped at 30 seconds. Valid `Retry-After` seconds or HTTP dates are honored when they are longer, within the 120-second per-case and 10-minute per-run retry-wait budgets. Configure these values with `--max-attempts` (or the retry-count alias `--retries`), `--retry-base-ms`, `--retry-cap-ms`, `--max-case-wait-ms`, and `--max-run-wait-ms`.

A persistent or non-retryable failure stops the current run. Compare mode does not start its next timeout budget after an incomplete run. The output is saved as `complete: false`, with not-attempted cases and per-attempt timing and failure metadata. Retry waits are excluded from model latency. The default lexical benchmark remains offline and makes no hosted calls.

## Browser comparison benchmark

Compare direct Chrome MCP calls with deterministic `browser_*` calls and
classifier-orchestrated workflows on resettable local fixtures.

1. Run scripted overhead measurements without hosted model calls:

   ```bash
   bun run --cwd .pi/agent benchmarks/browser-comparison.ts --phase scripted --runs 5 --warmups 1 --output /tmp/browser-scripted
   ```

2. Run the paid agent pilot with an explicit model and reasoning level:

   ```bash
   bun run --cwd .pi/agent benchmarks/browser-comparison.ts --phase agent --model openai-codex/gpt-6-luna --thinking high --runs 1 --warmups 0 --timeout-ms 90000 --max-turns 8 --output /tmp/browser-agent
   ```

The runner requires Chrome and cached `chrome-devtools-mcp@1.10.1`. It uses a
new headless profile per sample and never attaches to personal tabs. This Nix
setup uses `--no-sandbox`; run only the trusted local fixtures.

Setup, tool discovery, correctness verification, and cleanup are excluded from
timing. Each arm starts with its allowed tools active. Scripted arms use the
same explicit snapshot/action sequence, not an optimized native-tool strategy.
Agent success requires the expected private fixture state and completion within
the time/turn limits. Failures remain in the results.

Each output directory contains `metadata.json`, `samples.jsonl`, `summary.json`,
MCP logs, and tool-only `trace-*.json` files. Traces omit reasoning content.
Metadata records source hashes, SDK/runtime versions, model, and reasoning level.
Check classifier availability in that SDK's catalog before interpreting
orchestration results; `model-unavailable` is a setup failure, not evidence about
classifier decision quality. Missing usage is recorded rather than treated as
zero cost. Small pilots do not establish statistical significance.

## Complex browser flows

Compare classifier-only `browser_run` with Luna-high using browser wrappers
with `--baseline luna`. Both share the Chrome adapter, full snapshots, goals,
explicit inputs, and seeded initial states.
The fixtures cover conditional onboarding with duplicate email labels,
invoice validation recovery, and carrying a displayed code between views.
The last case tests a boundary of the current API, which accepts input values
but does not generate new ones from page content.

1. Set `PI_SDK_ROOT` to the installed `@earendil-works/pi-coding-agent` package
   root containing `dist/index.js`. Use a catalog that resolves the configured
   classifier models. SDK 1.3.0 passed this check; the project's 0.99.1 catalog
   did not. The runner does not upgrade dependencies.

2. Check all fixtures through the shared browser adapter without model calls:

   ```bash
   bun run --cwd .pi/agent benchmarks/browser-flow-comparison.ts --sdk-root "$PI_SDK_ROOT" --mode replay --flows onboarding,recovery,handoff --output /tmp/browser-flow-replay
   ```

3. Run one paid, counterbalanced pair per flow:

   ```bash
   bun run --cwd .pi/agent benchmarks/browser-flow-comparison.ts --sdk-root "$PI_SDK_ROOT" --baseline luna --flows onboarding,recovery,handoff --runs 1 --output /tmp/browser-flow-measured
   ```

The default normal model is `openai-codex/gpt-6-luna` at `high`. The classifier
arm uses the configured preference order and never falls back to Luna as a
planner. It renews `browser_run` once only when the first ten-step chunk reaches
`max_steps`. Both arms have a 20-action/effect budget and a three-minute
deadline. Native per-character input events count as one continuous edit.
An independent server-side check verifies exact saved values, one submission,
validation recovery, and unchanged protected fields.

The runner checks classifier catalog entries and makes native classifier and
Luna preflight requests before measurement. Availability failures stop the run;
they do not count as failed workflows. Preflight usage stays separate from
trial costs. The classifier arm records deterministic input steps as well as
classifier selections, so completion is not a measure of classifier decisions
alone.

Results include `metadata.json`, `preflight.json`, `samples.jsonl`,
`summary.json`, `state-*.json`, and tool-only `trace-*.json` files. Failed replays
also retain state and snapshot diagnostics. Setup and private-state verification
are outside the timer. The runner records primary and classifier usage,
fetch attempts, stop reasons, missing usage, and provider-reported cost
estimates. These estimates are not billing receipts. Exit code 2 means trials
finished with workflow failures; exit code 1 means the run was incomplete.

Treat one pair per case as a pilot. Keep task failures in the report, and do
not interpret the time to an early failure as a faster completed workflow.
The Chrome prerequisites and trusted-fixture restrictions above also apply.


## Flow speed against codemode + MCP

Time a form with two uniquely named fields, review, and save:

```bash
bun run --cwd .pi/agent benchmarks/browser-flow-comparison.ts --sdk-root "$PI_SDK_ROOT" --flows form --baseline codemode --warmups 1 --runs 5 --timeout-ms 90000 --max-turns 12 --output /tmp/browser-flow-speed-new
```

Use a fresh output directory. The runner verifies both paths complete in the
warmup pair before starting five counterbalanced measured pairs. Warmups remain
in the raw samples but do not contribute to summary medians or costs.

The default `--baseline codemode` activates Pi's real codemode extension with
native Chrome MCP tools. It exposes no browser wrappers or classifier-model
calls to the baseline. Luna-high generates its own scripts; batching is
allowed, including native `fill_form`. Native tool schemas are prepared before
timing, but model planning, script generation, and any additional discovery
the model chooses are timed.

`commitMs` ends at the independent server-side successful-save event.
`durationMs` ends when the controller returns after observing confirmation.
Report both, and verify each saved state. Failed flows have no comparable
successful-completion time.

This measures agent-generated codemode, not a prewritten or maximally batched
program. Sum the root codemode-call durations separately to see tool execution
time; do not equate that sum with the end-to-end flow time or pure MCP latency.
The baseline uses fewer native calls when it batches field inputs, even if
primary-model turns make its overall flow slower.
