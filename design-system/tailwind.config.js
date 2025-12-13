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
          primary: '#202020',
          secondary: '#2d2d2d',
          tertiary: '#373737',
        },
        foreground: {
          primary: '#ffffff',
          secondary: '#cccccc',
          tertiary: '#999999',
        },
        accent: {
          primary: '#0067c0',
          hover: '#106ebe',
          active: '#1a7fd4',
        },
        state: {
          success: '#73bc6f',
          warning: '#dea721',
          error: '#e35245',
          info: '#0067c0',
        },
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          hover: 'rgba(255, 255, 255, 0.15)',
        },
        waybar: {
          bg: 'rgba(44, 44, 44, 0.7)',
        },
      },
      fontFamily: {
        primary: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Monaco', 'Cascadia Code', 'Consolas', 'Courier New', 'monospace'],
        runic: ['BabelStone Runic', 'sans-serif'],
        symbols: ['Symbols Nerd Font', 'Segoe UI Symbol', 'Apple Color Emoji', 'sans-serif'],
        nerd: ['Symbols Nerd Font', 'sans-serif'],
        fluent: ['Segoe Fluent Icons', 'Segoe UI Symbol', 'sans-serif'],
      },
      fontSize: {
        'waybar-xs': '0.75rem',
        'waybar-sm': '0.8rem',
        'waybar-base': '0.85rem',
        'waybar-md': '0.9rem',
        'waybar-lg': '1.1rem',
        'waybar-xl': '1.4rem',
      },
      spacing: {
        'waybar-1': '0.2rem',
        'waybar-2': '0.33rem',
        'waybar-3': '0.6rem',
      },
      letterSpacing: {
        waybar: '0.05em',
      },
      textShadow: {
        waybar: '0 0 2px rgba(0, 0, 0, 0.3)',
        'waybar-button': '1px 1px rgba(0, 0, 0, 0.5)',
      },
    },
  },
  plugins: [
    // Add text-shadow utility
    function({ matchUtilities, theme }) {
      matchUtilities(
        {
          'text-shadow': (value) => ({
            textShadow: value,
          }),
        },
        { values: theme('textShadow') }
      )
    },
  ],
}
