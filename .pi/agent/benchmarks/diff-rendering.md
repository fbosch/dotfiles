# Diff rendering benchmark

Compare Delta with `@pi-archimedes/diff@2.11.2` on prepared TypeScript diffs.
This measures ANSI generation, not tool execution or terminal painting.

## Run

Prerequisites are Bun, Delta with the `Zenwritten Dark` syntax theme, and an
isolated installation of Archimedes. The runner never installs packages or
changes Pi settings.

1. Synchronize the installed Pi SDK mappings:

   ```bash
   bun run --cwd .pi/agent sdk:sync
   ```

2. Install the comparison package outside the repository:

   ```bash
   bench_dir=$(mktemp -d /tmp/pi-diff-engines.XXXXXX)
   npm install --prefix "$bench_dir" --ignore-scripts --no-audit --no-fund --package-lock=false @pi-archimedes/diff@2.11.2
   ```

3. Run the comparison from the repository root:

   ```bash
   bun .pi/agent/benchmarks/diff-rendering.ts \
     "$bench_dir/node_modules/@pi-archimedes/diff" > /tmp/pi-diff-results.json
   ```

The defaults are three independent trials per engine, fixture and layout,
three warmups, and ten samples per warm phase. Override them with
`PI_DIFF_TRIALS`, `PI_DIFF_WARMUPS` and `PI_DIFF_RUNS`. All must be positive
integers. The runner caps trials at 20 and warmups and samples at 100.
Each worker has a 120-second deadline; each Delta invocation has ten seconds.
A failure stops the run with a nonzero exit code and no complete result.

## Measurement policy

Fixtures replace 12, 60 or 1,600 lines. Each source line has a unique marker and
Danish letters. Inline output uses 120 columns; split output uses 200.
Both engines render every diff row. Archimedes' wrap-based fallback is disabled
so the layouts match. Line parsing and fixture preparation happen before timing.

Each engine gets a fresh Bun worker per trial. Engines run serially; their
order alternates across trials.

- `first-render` measures the first ANSI generation after module imports.
  Shiki's lazy initialization remains timed. This is not process startup or a
  cold filesystem-cache measurement.
- `warm-unique` uses distinct equal-length content tags after warmup.
  Neither input has previously entered the highlighting cache.
- `warm-repeat` regenerates ANSI for one explicitly primed input.
  This exercises Archimedes' highlighting cache, not its component repaint cache.
  Delta still starts a new process for every sample.

Delta receives a prepared unified patch through the standalone adapter in
`delta-baseline.ts`. Its process startup, patch parsing and pipe transfer remain
timed because its CLI cannot retain a warmed renderer. The active
`diff-rendering` extension uses local Shiki rendering and is not measured here.
Archimedes receives its prepared parsed-diff object directly. File writes,
line-diff computation, extension callbacks, output verification and hashing are
outside the timer.

Every output must contain every old and new source line and ANSI styles.
Failed verification invalidates the run. JSON records raw timings, output sizes
and hashes, medians, nearest-rank p95, ranges, runtime and engine versions, source
hashes, host details, and the exact sample policy. Separate workers are the
independent trials; samples within a warm worker are not independent trials.

## Interpretation limits

This is a synthetic rendering microbenchmark, not a general UI-performance test.
The small and medium cases remain eligible for Archimedes syntax highlighting.
The large case exceeds its highlighting limits and measures its reduced-quality
fallback against Delta's highlighted output. Do not call that an equal-quality
engine speed comparison.

Themes differ intentionally. Delta uses our `Zenwritten Dark` configuration;
Archimedes uses its standalone `github-dark` default. Word-level emphasis also
differs. The source-coverage check does not prove grammar highlighting succeeded.
There is no CPU, memory, allocation, UI-stall, component-repaint or physical
terminal measurement. Bun results do not establish Node performance.

The report declares no winner or statistical significance. Before using these
results to select an engine, choose a practical latency threshold for the actual
workflow and repeat under a quiet, representative environment.

## Validate the benchmark

Run the fixture/statistics tests and focused TypeScript check through devenv:

```bash
devenv tasks run test:pi-diff-rendering
```

The existing `test:pi-extensions` task also discovers the unit tests.
For an engine smoke run, use one trial, warmup and sample with the same runner.
