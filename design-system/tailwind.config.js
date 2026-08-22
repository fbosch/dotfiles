import { readFileSync } from 'node:fs';

const tokens = JSON.parse(readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));
const { colors, typography } = tokens;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './.storybook/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: {
          primary: colors.background.primary.value,
          secondary: colors.background.secondary.value,
          tertiary: colors.background.tertiary.value,
        },
        foreground: {
          primary: colors.foreground.primary.value,
          secondary: colors.foreground.secondary.value,
          tertiary: colors.foreground.tertiary.value,
        },
        ansi: {
          black: colors.ansi.black.value,
          red: colors.ansi.red.value,
          green: colors.ansi.green.value,
          yellow: colors.ansi.yellow.value,
          blue: colors.ansi.blue.value,
          magenta: colors.ansi.magenta.value,
          cyan: colors.ansi.cyan.value,
          white: colors.ansi.white.value,
          'bright-black': colors.ansi['bright-black'].value,
          'bright-red': colors.ansi['bright-red'].value,
          'bright-green': colors.ansi['bright-green'].value,
          'bright-yellow': colors.ansi['bright-yellow'].value,
          'bright-blue': colors.ansi['bright-blue'].value,
          'bright-magenta': colors.ansi['bright-magenta'].value,
          'bright-cyan': colors.ansi['bright-cyan'].value,
          'bright-white': colors.ansi['bright-white'].value,
        },
        accent: {
          primary: colors.accent.primary.value,
          hover: colors.accent.hover.value,
          active: colors.accent.active.value,
          'active-text': colors.accent['active-text'].value,
          text: colors.accent.text.value,
        },
        state: {
          success: colors.state.success.value,
          'success-hover': colors.state['success-hover'].value,
          'success-text': colors.state['success-text'].value,
          'success-active': colors.state['success-active'].value,
          'success-active-text': colors.state['success-active-text'].value,
          warning: colors.state.warning.value,
          'warning-hover': colors.state['warning-hover'].value,
          'warning-text': colors.state['warning-text'].value,
          'warning-active': colors.state['warning-active'].value,
          'warning-active-text': colors.state['warning-active-text'].value,
          error: colors.state.error.value,
          'error-hover': colors.state['error-hover'].value,
          'error-text': colors.state['error-text'].value,
          'error-active': colors.state['error-active'].value,
          'error-active-text': colors.state['error-active-text'].value,
          info: colors.state.info.value,
          'info-hover': colors.state['info-hover'].value,
          'info-text': colors.state['info-text'].value,
          'info-active': colors.state['info-active'].value,
          'info-active-text': colors.state['info-active-text'].value,
          purple: colors.state.purple.value,
          'purple-hover': colors.state['purple-hover'].value,
          'purple-text': colors.state['purple-text'].value,
          'purple-active': colors.state['purple-active'].value,
          'purple-active-text': colors.state['purple-active-text'].value,
        },
        border: {
          DEFAULT: colors.border.default.value,
          hover: colors.border.hover.value,
        },
        surface: {
          border: colors.surface.border.value,
          keyline: colors.surface.keyline.value,
        },
        waybar: {
          bg: `${colors.background.secondary.value}b3`,
        },
      },
      fontFamily: {
        primary: [
          typography.fontFamily.primary.value,
          'SF Pro Text',
          'Segoe Fluent Icons',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        button: [
          typography.fontFamily.button.value,
          typography.fontFamily.primary.value,
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          typography.fontFamily.monospace.value,
          'SF Mono',
          'Monaco',
          'Cascadia Code',
          'Consolas',
          'Courier New',
          'monospace',
        ],
        runic: [typography.fontFamily.runic.value, 'sans-serif'],
        symbols: [
          typography.fontFamily.symbols.value,
          'Segoe UI Symbol',
          'Apple Color Emoji',
          'sans-serif',
        ],
        nerd: [typography.fontFamily.symbols.value, 'sans-serif'],
        fluent: ['Segoe Fluent Icons', 'sans-serif'],
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
      },
      keyframes: {
        'update-progress': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(200%)' },
        },
      },
      animation: {
        'update-progress': 'update-progress 1.4s ease-in-out infinite alternate',
      },
      textShadow: {
        waybar: '0 0 2px rgba(0, 0, 0, 0.3)',
        'waybar-button': '1px 1px rgba(0, 0, 0, 0.5)',
        subtle: '0 1px 2px rgba(0, 0, 0, 0.2)',
      },
    },
  },
  plugins: [
    // Add text-shadow utility
    ({ matchUtilities, theme }) => {
      matchUtilities(
        {
          'text-shadow': (value) => ({
            textShadow: value,
          }),
        },
        { values: theme('textShadow') }
      );
    },
  ],
};
