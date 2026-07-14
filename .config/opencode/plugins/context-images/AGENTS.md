# Context Images Plugin

## Workflow

- Read `CONTEXT.md` before changing discovery, rendering, replacement, model capability, or compaction behavior.
- Preserve the wholesale replacement contract: attach every image page and the factsheet before atomically removing matched plaintext.
- Fail open to the original plaintext. Never send an image as supplementary duplicate context.
- Keep nested read-scoped replacement default-off. When enabled, discover only `AGENTS.md` paths supplied by OpenCode's trusted Read metadata and preserve plaintext unless every package validates.
- Keep durable design decisions and measured baselines in `CONTEXT.md`; keep commands and temporary plans out of it.

## Validation

Run the tests and plugin-scoped Fallow checks after code changes:

```sh
bun test
npx --yes fallow --root . --config .fallowrc.json health
npx --yes fallow --root . --config .fallowrc.json dead-code
npx --yes fallow --root . --config .fallowrc.json dupes
```

After performance changes, run `bun run bench` and update `BENCHMARK.md` only from measured results on the same host.
