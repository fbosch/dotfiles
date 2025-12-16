/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./.storybook/**/*.{js,ts,jsx,tsx}",
  ],
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
          "success-hover": "#82cc7d",
          "success-text": "#00480b",
          warning: "#dea721",
          "warning-hover": "#e8b230",
          "warning-text": "#613900",
          error: "#e35245",
          "error-hover": "#ff6b5a",
          "error-text": "#400000",
          info: "#0067c0",
        },
        border: {
          DEFAULT: "rgba(255, 255, 255, 0.08)",
          hover: "rgba(255, 255, 255, 0.15)",
        },
        waybar: {
          bg: "rgba(44, 44, 44, 0.7)",
        },
      },
      fontFamily: {
        primary: [
          "SF Pro Display",
          "SF Pro Text",
          "Segoe Fluent Icons",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        button: [
          "SF Pro Rounded",
          "SF Pro Display",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SF Mono",
          "Monaco",
          "Cascadia Code",
          "Consolas",
          "Courier New",
          "monospace",
        ],
        runic: ["BabelStone Runic", "sans-serif"],
        symbols: [
          "Symbols Nerd Font",
          "Segoe UI Symbol",
          "Apple Color Emoji",
          "sans-serif",
        ],
        nerd: ["Symbols Nerd Font", "sans-serif"],
        fluent: ["Segoe Fluent Icons", "sans-serif"],
      },
      fontSize: {
        xs: "0.75rem",
        sm: "0.875rem", 
        base: "1rem",
        lg: "1.125rem",
        xl: "1.25rem",
        "2xl": "1.5rem",
      },
      textShadow: {
        waybar: "0 0 2px rgba(0, 0, 0, 0.3)",
        "waybar-button": "1px 1px rgba(0, 0, 0, 0.5)",
      },
    },
  },
  plugins: [
    // Add text-shadow utility
    ({ matchUtilities, theme }) => {
      matchUtilities(
        {
          "text-shadow": (value) => ({
            textShadow: value,
          }),
        },
        { values: theme("textShadow") },
      );
    },
  ],
};
