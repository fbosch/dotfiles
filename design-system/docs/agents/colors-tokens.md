# Color System and Tokens

Hierarchical palette:

- Background layers: `primary` → `secondary` → `tertiary` (#202020 → #2d2d2d → #373737)
- Foreground tiers: `primary` → `secondary` → `tertiary` (#ffffff → #cccccc → #999999)
- Accent: blue #0067c0 with hover and active states
- Semantic states: success, warning, error, info, purple

Token pattern:

- Base tokens live in `tokens.json`
- Mapped to Tailwind in `tailwind.config.js`
- Hover states are separate tokens (avoid computed values)

State palette:

- success: #73bc6f
- warning: #dea721
- error: #e35245
- info: #0067c0
- purple: #9b59b6

Purple rationale:

Purple is intentionally lighter to align with Zenwritten Dark, providing a softer alternative for secondary actions while retaining contrast.

Token usage in Tailwind:

```javascript
export default {
  theme: {
    extend: {
      colors: {
        background: {
          primary: "#202020",
          secondary: "#2d2d2d",
          tertiary: "#373737",
        },
        foreground: {
          primary: "#ffffff",
          secondary: "#cccccc",
          tertiary: "#999999",
        },
        accent: {
          primary: "#0067c0",
          hover: "#106ebe",
          active: "#1a7fd4",
        },
        state: {
          success: "#73bc6f",
          warning: "#dea721",
          error: "#e35245",
          info: "#0067c0",
        },
      },
      fontFamily: {
        primary: ["Zenbones Brainy", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
};
```
