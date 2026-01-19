# Component Variants and CVA

Use CVA-based variants for component styling.

Guidelines:

- Base styles contain shared properties (layout, typography, transitions)
- Variants only define what changes (colors, sizes)
- Boolean variants preferred over multiplicative variants
- Compound variants for specific combinations
- Minimal variants for most components
- Buttons are the exception and support seven variants

Example pattern:

```typescript
const componentVariants = cva("shared-base-styles", {
  variants: {
    variant: {
      /* visual styles */
    },
    size: {
      /* dimensions */
    },
    fullWidth: {
      /* layout modifier */
    },
  },
});
```

Variant guidelines:

- Keep variants minimal (2-4 per property) unless the component is a button
- Avoid creating variants for every possible visual state
- Prefer boolean variants (e.g. `active`) instead of multiplying variants

Avoid:

```typescript
variants: {
  variant: {
    primary: "...",
    secondary: "...",
    ghost: "...",
    danger: "...",
    warning: "...",
    info: "...",
    success: "...",
    outline: "...",
    link: "...",
  },
  size: {
    xs: "...",
    sm: "...",
    md: "...",
    lg: "...",
    xl: "...",
    "2xl": "...",
  },
}
```

Do:

```typescript
variants: {
  variant: {
    primary: "bg-accent-primary hover:bg-accent-hover",
    secondary: "bg-background-tertiary hover:bg-background-tertiary/80",
    ghost: "bg-transparent hover:bg-white/5",
  },
  size: {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-1.5 text-sm",
    lg: "px-6 py-2 text-base",
  },
}
```

Composition example:

```typescript
const buttonVariants = cva(
  "inline-flex items-center gap-2 px-4 py-2 rounded-md transition-colors",
  {
    variants: {
      variant: {
        primary: "bg-accent-primary hover:bg-accent-hover",
        secondary: "bg-gray-500 hover:bg-gray-600",
        ghost: "bg-transparent hover:bg-white/5",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-lg",
      },
      active: {
        true: "ring-2 ring-accent-primary",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "ghost",
        active: true,
        className: "bg-white/10",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      active: false,
    },
  }
);
```
