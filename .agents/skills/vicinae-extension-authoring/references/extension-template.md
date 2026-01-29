# Extension Template

Use this structure for new Vicinae extensions in this repo. Keep files minimal; add modules only when needed.

## Minimal structure

```
extension-name/
  assets/
    extension_icon.png
  src/
    extension-name.tsx
    types.ts
  package.json
  tsconfig.json
  vicinae-env.d.ts
  README.md
```

## Expanded structure (preferred for non-trivial features)

```
extension-name/
  assets/
    extension_icon.png
  src/
    api.ts
    cache.ts
    constants.ts
    queryClient.ts
    types.ts
    hooks/
      useDebounce.ts
    components/
      ItemDetail.tsx
    utils/
      formatters.ts
    extension-name.tsx
  package.json
  tsconfig.json
  vicinae-env.d.ts
  README.md
```

## Manifest essentials (package.json)

- Use the Vicinae schema `$schema` field.
- `name` must match directory name.
- Include at least one command with `mode: "view"`.
- Include `@vicinae/api` dependency.
- Include `extension_icon.png` (512x512, 1:1).

## Local dev requirements

- NodeJS >= 20
- npm-compatible package manager (pnpm preferred in this repo)

## Dev/build commands

- `pnpm -C <extension> dev`
- `pnpm -C <extension> build`
- `pnpm -C <extension> lint`

## Query + cache module split

- `constants.ts`: keys + TTLs + shared defaults.
- `cache.ts`: Vicinae Cache helpers (get/set/clear).
- `queryClient.ts`: QueryClient with defaults.
- `api.ts`: network calls and response shaping.

Use `constants.ts` to keep TTLs aligned across Cache and React Query.
