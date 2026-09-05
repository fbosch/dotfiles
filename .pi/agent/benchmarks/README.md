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
