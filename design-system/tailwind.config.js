/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          primary: '#0067c0',
          hover: '#106ebe',
          focus: '#1a7fd4',
        },
        state: {
          idle: '#73bc6f',
          warning: '#dea721',
          critical: '#e35245',
          error: '#ff6b6b',
        },
        text: {
          primary: '#ffffff',
          secondary: '#cccccc',
          tertiary: '#999999',
          muted: 'rgba(255, 255, 255, 0.4)',
        },
        surface: {
          bg: 'rgba(32, 32, 32, 0.85)',
          'bg-waybar': 'rgba(44, 44, 44, 0.7)',
          'bg-solid': 'rgb(32, 32, 32)',
          'layer-1': 'rgba(45, 45, 45, 0.6)',
          'layer-2': 'rgba(55, 55, 55, 0.7)',
          'layer-3': 'rgba(65, 65, 65, 0.8)',
          subtle: 'rgba(255, 255, 255, 0.01)',
          hover: 'rgba(255, 255, 255, 0.05)',
          active: 'rgba(255, 255, 255, 0.1)',
        },
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.08)',
          subtle: 'rgba(255, 255, 255, 0.1)',
          hover: 'rgba(255, 255, 255, 0.15)',
        },
      },
    },
  },
  plugins: [],
}
