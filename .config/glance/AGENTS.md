# AGENTS

Configuration for Glance dashboard pages, widgets, and assets.

## Essentials

- Keep page layout in `pages/` and reusable widget definitions in `widgets/`.
- Do not inline widget definitions in `pages/`; create reusable files in `widgets/` and include them.
- Keep shared styling/assets in `assets/` and global wiring in `glance.yml`.
- If widget-specific inline CSS grows beyond a small block, move it to a dedicated file in `assets/css/` (e.g., `assets/css/plex.css`).
- Keep secrets out of committed YAML; use runtime environment variables.
- API keys and tokens must always be read from environment variables.
- Prefer local files and scripts in this directory over external docs.
- After major config changes, verify with: `journalctl -u glance.service --no-pager -n 200`
- For favicons/site icons, use Twenty Icons API: `https://twenty-icons.com/{{ $domain }}` (pass domain only, without protocol)

## References

- `glance.yml`
- `pages/`
- `widgets/`
- `assets/README.md`
- `scripts/`
- [Widget development guide](docs/widget-development.md)
