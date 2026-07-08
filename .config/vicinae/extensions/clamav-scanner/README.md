# ClamAV Scanner

Vicinae extension for running ClamAV scans from the launcher.

## Commands

- `Scan Directory` opens an interactive scanner for a selected or typed path.
- `Quick Scan Home` runs a no-view scan of the home directory and reports through HUD/toasts.
- `Update Virus Database` runs `freshclam` for local virus definitions.

## Requirements

- `clamscan` and `freshclam` must be available on `PATH`.
- Virus definitions must exist before scans are useful. The update command writes them under `~/.clamav/`.

Package installation is handled outside this repo.

## Preferences

- Recursive scanning.
- Show infected files only.
- Auto-remove infected files.
- Exclude patterns as comma-separated regexes, for example `.*\.log,.*\.tmp,node_modules/.*`.

Use auto-remove carefully. It deletes infected files without a separate confirmation step.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build
```

The icon uses the official [ClamAV logo](https://commons.wikimedia.org/wiki/File:ClamAV_Logo.png), licensed under GPLv2.
