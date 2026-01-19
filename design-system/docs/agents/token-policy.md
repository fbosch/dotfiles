# Token Policy

Token consistency principle:

- Do not create custom tokens for single-use cases or specific features
- Use standard Tailwind spacing scale, font sizes, and letter spacing
- Only add new tokens when reused across multiple components

Avoid:

```typescript
spacing: {
  "waybar-1": "0.2rem",
  "waybar-2": "0.33rem",
  "waybar-3": "0.6rem",
}
fontSize: {
  "waybar-sm": "0.8rem",
  "waybar-xl": "1.4rem",
}
letterSpacing: {
  "waybar": "0.05em",
}
```

Prefer:

```typescript
<div className="p-1 m-2 text-xs tracking-wide">
<div className="p-2 m-3 text-sm tracking-normal">
<div className="p-3 m-4 text-base tracking-tight">
<div className="px-4 text-2xl">
<div className="px-[1.1rem]">
```

Add custom tokens only when reused across multiple components (colors, fonts, shared utilities).
