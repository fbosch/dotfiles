# Build and Dev Workflow

Build a single extension (preferred):

```bash
cd .config/vicinae/extensions/extension-name
pnpm install  # Only if dependencies changed
pnpm run build
```

Bulk build (fresh setup or major updates):

```bash
./scripts/vicinae-build-extensions.sh
```

## mprocs entry

Add new extensions to `mprocs.yaml` for dev:

```yaml
vicinae-extension-name:
  autostart: false
  shell: "(cd .config/vicinae/extensions/extension-name && pnpm run dev)"
```
