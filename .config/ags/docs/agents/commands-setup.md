# Commands and Setup

## Start bundled AGS

```bash
./start-daemons.sh
```

Manual start:

```bash
cd ~/.config/ags && ags run config-bundled.tsx
```

## IPC communication

```bash
ags msg ags-bundled '{"window":"start-menu","action":"toggle"}'
ags msg ags-bundled '{"window":"window-switcher","action":"next"}'
```

## TypeScript type definitions

Type definitions for GObject Introspection libraries are auto-generated in `.config/ags/@girs/` (git-ignored). `bun install` generates them only when the core typings are missing.

Regenerate explicitly after updating AGS or system GTK libraries:

```bash
cd ~/.config/ags
bun run types
```

Regenerate when:

- After updating AGS or system GTK libraries
- TypeScript shows "Cannot find module" errors for GI imports

## AI Pointer benchmarks

```bash
bun run benchmark:ai-pointer
```

This command measures pure click and drag policy throughput, workflow initialization and teardown, and inert click and drag interactions. It injects capture, accessibility, OCR, program, click-geometry, pointer, storage, and view dependencies, so it does not invoke `grim`, inspect AT-SPI, read Hyprland state, create captures, or emit selected content. RSS output is process-wide and includes runtime and JIT retention; it is not an allocation or leak measurement. Adjust bounded sample sizes with `AI_POINTER_BENCH_SAMPLES`, `AI_POINTER_POLICY_BATCH`, and `AI_POINTER_WORKFLOW_BATCH`.

For live stage timings against the deployed bundle:

```bash
bun run benchmark:ai-pointer:live
```

1. Complete the requested mix of accessible and fallback clicks and drags.
2. Close each preview before starting the next interaction.
3. Read the generated summary path printed when the requested runs finish.

The collector uses filesystem events, defaults to eight completed runs and a 180-second timeout, and removes its exclusive benchmark lock on completion, timeout, handled signals, and ordinary errors. Configure it with `AI_POINTER_LIVE_RUNS` and `AI_POINTER_LIVE_TIMEOUT_SECONDS`. It writes private runtime files containing allowlisted stage names, monotonic durations, success booleans, and process RSS only; geometry, paths, program metadata, accessible metadata, OCR text, diagnostic errors, and captured content are excluded. An uncatchable process termination can leave a stale lock, which must be removed before starting another live collection.

Feature-specific benchmark drivers are colocated under `components/<feature>/__benchmarks__/`. Service-wide drivers live under `services/__benchmarks__/`, while shared process orchestration and result analysis remain under `scripts/benchmark/`.

## AGS command reference

```bash
ags run <file.tsx>
ags list
ags request -i <instance-name> '<json-payload>'
ags quit <instance-name>
ags toggle <window-name>
ags types
ags bundle <file.tsx>
ags inspect
~/.config/ags/start-daemons.sh
```
