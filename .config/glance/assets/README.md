# Assets Directory Structure

Organized assets for the Glance dashboard.

## Directory Layout

```
assets/
├── css/           # Stylesheets
│   ├── custom.css
│   └── komodo-containers.css
├── icons/         # SVG icons
│   ├── pihole-two.svg
│   ├── vaultwarden.svg
│   └── portainer.svg
└── js/            # JavaScript files
    ├── mullvad-check.js
    ├── service-worker.js
    └── sw-register.js
```

## Usage

### CSS Files
Referenced in `glance.yml`:
```yaml
theme:
  custom-css-file: /assets/css/custom.css
```

### JavaScript Files
Loaded in document head via `glance.yml`:
```yaml
document:
  head: |
    <script src="/assets/js/mullvad-check.js"></script>
    <script src="/assets/js/sw-register.js"></script>
```

### Icons
Referenced in widget configurations:
```yaml
icon: /assets/icons/pihole-two.svg
```

## Adding New Assets

### Icons
1. Save SVG files to `icons/` directory
2. Reference them in widgets: `/assets/icons/filename.svg`
3. Icons from your previous site (home.corvus-corax.synology.me) have been extracted

### CSS
1. Add new stylesheets to `css/` directory
2. Import in `custom.css` or reference directly in `glance.yml`

### JavaScript
1. Add new scripts to `js/` directory
2. Load via `document.head` in `glance.yml`

## Icon Sources

- **Dashboard Icons** (di:): https://dashboardicons.com
- **Simple Icons** (si:): https://simpleicons.org
- **selfh.st** (sh:): https://selfh.st/icons/
- **Material Design Icons** (mdi:): https://pictogrammers.com/library/mdi/
- **Custom**: Extracted from home.corvus-corax.synology.me or custom-created
