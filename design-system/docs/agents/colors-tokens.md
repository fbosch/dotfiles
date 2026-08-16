# Color System and Tokens

Hierarchical palette:

- Background layers: `primary` → `secondary` → `tertiary` (#191919 → #242424 → #2a2a2a)
- Foreground tiers: `primary` → `secondary` → `tertiary` (#ffffff → #bbbdc7 → #8c8e96)
- Accent: Zenwritten ANSI blue (#6099c0), bright blue hover (#61abda), and dark blue selected surfaces (#324757)
- Semantic states reuse the Zenwritten ANSI color families for their base and hover values, with contrast-safe active variants

Token pattern:

- Base tokens live in `tokens.json`
- Mapped to Tailwind in `tailwind.config.js`
- Hover states are separate tokens (avoid computed values)

State palette:

- success: #819b69 → #8bae68 → #6b8556
- warning: #b77e64 → #d68c67 → #9c6a51
- error: #de6e7c → #e8838f → #b85763
- info: #6099c0 → #61abda → #324757
- purple: #b279a7 → #cf86c1 → #8d5b83

Purple rationale:

Blossom provides a softer secondary action color while retaining contrast.

Token usage in Tailwind:

```javascript
export default {
  theme: {
    extend: {
      colors: {
        background: {
          primary: "#191919",
          secondary: "#242424",
          tertiary: "#2a2a2a",
        },
        foreground: {
          primary: "#ffffff",
          secondary: "#bbbdc7",
          tertiary: "#8c8e96",
        },
        accent: {
          primary: "#6099c0",
          hover: "#61abda",
          active: "#324757",
          "active-text": "#ffffff",
        },
        state: {
          success: "#819b69",
          "success-hover": "#8bae68",
          "success-active": "#6b8556",
          warning: "#b77e64",
          "warning-hover": "#d68c67",
          "warning-active": "#9c6a51",
          error: "#de6e7c",
          "error-hover": "#e8838f",
          "error-active": "#b85763",
          info: "#6099c0",
          "info-hover": "#61abda",
          "info-active": "#324757",
          purple: "#b279a7",
          "purple-hover": "#cf86c1",
          "purple-active": "#8d5b83",
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
