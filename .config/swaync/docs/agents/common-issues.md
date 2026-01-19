# Common Issues

Buttons too wide:

- Cause: GTK layout stretches buttons
- Fix: `width: auto`, `min-width: auto`, `flex-shrink: 0`, `flex-grow: 0`

Spacing not working:

- Cause: using `gap` (flex/grid only)
- Fix: use `margin` or `padding`

Percentage sizing unreliable:

- Cause: GTK sizing context differs from web CSS
- Fix: use fixed pixel values or `auto`

Selector not working:

- Cause: unsupported selectors (`:has`, `:is`, `:where`)
- Fix: use basic selectors only

CSS changes not applying:

- Run `swaync-client -rs`
- Ensure `config.json` includes `"cssPriority": "user"`
- Use GTK Inspector (`GTK_DEBUG=interactive swaync`)
