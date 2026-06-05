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

## Dev Server

Run an extension dev server from the repo root:

```bash
just vicinae-dev extension-name
```
