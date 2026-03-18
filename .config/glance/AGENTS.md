# AGENTS

Configuration for Glance dashboard pages, widgets, and assets.

## Essentials

- Do not inline widget definitions in page files; create reusable widget files and include them.
- If widget-specific inline CSS grows beyond a small block, move it to a dedicated file in `assets/css/`.
- Keep secrets out of committed YAML; use runtime environment variables.
- After major config changes, verify with: `journalctl -u glance.service --no-pager -n 200`
- For favicons/site icons, use Twenty Icons API: `https://twenty-icons.com/{{ $domain }}` (pass domain only, without protocol)

## References

- `glance.yml`
- `pages/`
- `widgets/`
- `assets/README.md`
- `scripts/`
- [Widget development guide](docs/widget-development.md)
