# GTK4 CSS Limits and Features

SwayNC uses GTK4 CSS (not web CSS). Layout is controlled by widget hierarchy, not flexbox/grid.

## Not supported

- Flexbox/grid (`display: flex`, `display: grid`, `gap` in flex/grid context)
- Advanced selectors (`:has`, `:is`, `:where`)
- Modern layout features (`aspect-ratio`, `container-type`, `position`, `z-index`)
- Percentage sizing is unreliable
- `box-sizing: border-box` may not behave like web CSS

## Supported

- Typography: `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`
- Colors: `color`, `background-color`, `border-color`, `opacity`
- Box model: `margin`, `padding`, `border`, `border-radius`, `outline`
- Sizing: `width`, `height`, `min-width`, `min-height`, `max-width`, `max-height`
- Effects: `box-shadow`, `text-shadow`, `filter`
- Transitions: `transition`, `animation`, `transform`

## CSS variables

```css
:root {
  --bg-color: rgba(32, 32, 32, 0.85);
  --text-color: #ffffff;
}

.notification {
  background: var(--bg-color);
  color: var(--text-color);
}
```

## GTK-specific properties

```css
.app-icon {
  -gtk-icon-source: url("icon.svg");
  -gtk-icon-size: 24px;
  -gtk-icon-transform: scale(1.2);
  -gtk-icon-palette: success green, error red;
  -gtk-icon-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

* {
  -gtk-dpi: 96;
}
```

## Color syntax

GTK4 supports modern color syntax:

```css
color: rgb(255, 0, 0);
color: rgba(255, 0, 0, 0.5);
color: hsl(120, 100%, 50%);
color: hwb(120 30% 20%);
color: oklab(0.5 0.1 0.1);
color: oklch(0.5 0.2 180);
color: color-mix(in srgb, red 50%, blue);
```

## Media queries

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
}
```
