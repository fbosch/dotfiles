# Favorite Directories

Vicinae no-view commands for opening frequently used directories from global search.

## Commands

Each configured directory becomes its own command, such as `Downloads`, `Pictures`, `Dotfiles`, NAS folders, and `LaCie`.

The current directory list is generated from `scripts/generate.js` into `src/open-*.ts` files and `package.json` commands.

## File Manager

The extension can auto-detect a file manager or use the preference value. Supported values are:

- `nemo`
- `nautilus`
- `dolphin`
- `thunar`
- `pcmanfm`

Detection is cached so normal opens do not repeatedly probe the system.

## Changing Directories

Edit the `DIRECTORIES` array in `scripts/generate.js`, then regenerate:

```bash
pnpm run generate
pnpm run build
```

The generator also creates PNG icons from the local icon theme when the source assets are available.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build
```
