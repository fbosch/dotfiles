/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
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
      },
      fontFamily: {
        primary: ['Zenbones Brainy', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        runic: ['BabelStone Runic', 'sans-serif'],
        symbols: ['Symbols Nerd Font', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
