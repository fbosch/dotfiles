# Styling and Design System

## CSS loading

Keep static feature styling in a colocated `styles.scss` file. Scope the file
once with the shared surface mixin and register it in `styles/stylesheets.ts`:

```scss
@use "../../styles/surface" as ags;

@include ags.surface("example-widget") {
  .content { color: var(--ags-color-foreground-primary); }
}
```

`component-host.ts` loads the composed stylesheet through `app.start({ css })`.
Use `app.apply_css()` only for values computed from live data that cannot be
represented by state classes or native widget properties.

## GTK CSS specifics

1. Spacing:
   - GTK `spacing` property on `<box>` is separate from CSS
   - Use CSS `margin` and `padding` for visual spacing
   - `<box spacing={12}>` only affects space between children

2. Selectors:

```css
window { }
box { }
button { }
label { }

.my-class { }
window.my-window { }
button.confirm { }

box button { }
button label { }
```

3. Pseudo-classes:

```css
button:hover { }
button:active { }
button:focus { }
```

4. Common properties:

```css
padding: 20px;
margin: 10px;
background-color: rgb(32, 32, 32);
color: #ffffff;
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 12px;
font-size: 14px;
font-weight: 600;
font-family: "SF Pro Rounded", system-ui;
min-width: 100px;
min-height: 40px;
```

## Design system alignment

Colors:

- Import `../../../design-system/tokens.json`; do not hard-code design-system palette values.
- Background: `tokens.colors.background.primary`
- Surface: `tokens.colors.background.secondary`
- Surface hover: `tokens.colors.background.tertiary`
- Border: `tokens.colors.border`
- Text: `tokens.colors.foreground`
- Accent: `tokens.colors.accent`
- Semantic states: `tokens.colors.state`

Typography:

- Font family: "SF Pro Rounded", system-ui, sans-serif
- Sizes: `13px` (small), `14px` (base), `16px` (default), `20px` (title), `48px` (icon)

Spacing:

- Border radius: `6px` (buttons), `12px` (small), `18px` (medium)
- Padding: `10px 32px` (buttons), `32px 40px` (dialog)
- Margins: `8px`, `16px`, `20px`, `24px`

Transitions:

- Use `transition: none;` for instant appearance
- Hover effects can transition `background-color` and `border-color`

Shadows:

```css
box-shadow:
  0.4px 0.8px 0.7px hsl(0deg 0% 0% / 0.15),
  0.7px 1.3px 1.1px -1.7px hsl(0deg 0% 0% / 0.12),
  2.4px 4.6px 3.9px -3.3px hsl(0deg 0% 0% / 0.08),
  7.1px 13.6px 11.5px -5px hsl(0deg 0% 0% / 0.04);
```
