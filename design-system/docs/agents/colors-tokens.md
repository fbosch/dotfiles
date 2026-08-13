# Color System and Tokens

Hierarchical palette:

- Background layers: `primary` → `secondary` → `tertiary` (#191919 → #242424 → #2a2a2a)
- Foreground tiers: `primary` → `secondary` → `tertiary` (#ffffff → #bbbdc7 → #8c8e96)
- Accent: Zenwritten sky (#6baedb) with bright-sky hover and water active states
- Semantic states: leaf success, wood warning, rose error, sky info, blossom secondary action

Token pattern:

- Base tokens live in `tokens.json`
- Mapped to Tailwind in `tailwind.config.js`
- Hover states are separate tokens (avoid computed values)

State palette:

- success: #7aca6c
- warning: #c69761
- error: #d86659
- info: #6baedb
- purple: #b671a1

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
          primary: "#6baedb",
          hover: "#7bbefb",
          active: "#5b64db",
        },
        state: {
          success: "#7aca6c",
          warning: "#c69761",
          error: "#d86659",
          info: "#6baedb",
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
