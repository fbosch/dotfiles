# Commands and Setup

## Start bundled AGS

```bash
./start-daemons.sh
```

Manual start:

```bash
ags run ~/.config/ags/config-bundled.tsx
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
