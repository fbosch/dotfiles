# Glance Assets

Static files served by Glance from `/assets/*`. The container maps this directory through `server.assets-path` in `glance.yml`.

## Layout

- `css/` contains the global theme CSS and widget-specific styles.
- `icons/` contains local favicons, profile images, and service icons.
- `js/` contains small client-side helpers loaded from `document.head`.

## Current Entry Points

`glance.yml` references these assets directly:

- `/assets/css/custom.css`
- `/assets/css/start-command-prompt.css`
- `/assets/css/real-debrid.css`
- `/assets/css/plex.css`
- `/assets/css/komodo-containers.css`
- `/assets/js/quicklink-init.js`
- `/assets/js/freshrss-actualize.js`
- `/assets/js/start-command-prompt.js`
- `/assets/js/real-debrid-live.js`
- `/assets/icons/politoed.png`
- `/assets/icons/favicon.ico`

Widget YAML can also reference icons directly, for example `/assets/icons/pihole-two.svg`.

## Adding Assets

- Put shared dashboard CSS in `css/custom.css`.
- Put widget-specific CSS in a dedicated file under `css/` once inline CSS stops being small.
- Put client-side widget scripts under `js/` and load them from `document.head` in `glance.yml`.
- Prefer Twenty Icons API for normal service favicons; keep local icons for custom branding or assets that need to stay stable.
