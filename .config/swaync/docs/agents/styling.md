# Styling Patterns

## Button sizing

GTK widgets do not respect flex sizing. Use explicit sizing:

```css
.notification-action {
  width: auto;
  min-width: auto;
  height: 28px;
  padding: 0 12px;
  flex-shrink: 0;
  flex-grow: 0;
  margin: 8px 6px 0 0;
}
```

## Layout and spacing

Use margins instead of `gap`:

```css
.notification-action {
  margin-right: 6px;
}

.notification-action:last-child {
  margin-right: 0;
}
```

## Colors and transparency

```css
background: rgba(32, 32, 32, 0.85);
border: 1px solid rgba(255, 255, 255, 0.1);

--bg-color: rgba(32, 32, 32, 0.85);
background: var(--bg-color);
```

## Transitions and animations

```css
.notification-action {
  transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
}

.notification-action:active {
  transform: scale(0.98);
}
```

## Style organization

```css
* { all: unset; }
:root { }
.notification-window { }
.floating-notifications { }
.control-center { }
.widget { }
```

## Theme variants

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1e1e2e;
  }
}

@media (prefers-color-scheme: light) {
  :root {
    --bg-primary: #eff1f5;
  }
}
```
