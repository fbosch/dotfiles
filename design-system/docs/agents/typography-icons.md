# Typography and Icons

Font stack:

- Primary: SF Pro Text
- Mono: JetBrains Mono
- Specialized: Nerd Font symbols, Fluent icons

Icon fonts:

- Segoe Fluent Icons (`font-fluent`) is the primary icon font
- Segoe MDL2 Assets is legacy (prefer Fluent Icons)
- Icon reference: https://github.com/MicrosoftDocs/windows-dev-docs/blob/docs/hub/apps/design/style/segoe-ui-symbol-font.md

Use unicode characters directly in JSX for icons, e.g. `E713` for Settings:

```tsx
<span className="font-fluent">\uE713</span>
```

Type scale:

- Uses Tailwind defaults: `text-xs`, `text-sm`, `text-base`
- Medium weight (500) for buttons/emphasis, normal (400) for body
