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

Type definitions for GObject Introspection libraries are auto-generated in `.config/ags/@girs/` (git-ignored).

Generate types (run after installing AGS or updating GTK libraries):

```bash
cd ~/.config/ags
ags types
```

Regenerate when:

- Fresh system setup
- After updating AGS or system GTK libraries
- TypeScript shows "Cannot find module" errors for GI imports

## AI Pointer benchmarks

```bash
pnpm benchmark:ai-pointer
```

This command measures pure click and drag policy throughput, controller initialization and teardown, and inert click and drag interactions. It injects capture, accessibility, OCR, program, click-geometry, pointer, storage, and view dependencies, so it does not invoke `grim`, inspect AT-SPI, read Hyprland state, create captures, or emit selected content. RSS output is process-wide and includes runtime and JIT retention; it is not an allocation or leak measurement. Adjust bounded sample sizes with `AI_POINTER_BENCH_SAMPLES`, `AI_POINTER_POLICY_BATCH`, and `AI_POINTER_CONTROLLER_BATCH`.

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
