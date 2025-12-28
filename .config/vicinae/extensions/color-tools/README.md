# Color Tools

A Vicinae extension with two utilities for working with colors and opacity.

## Commands

### 1. Tailwind Colors

Browse the complete Tailwind color palette with opacity controls.

**Features:**
- Browse 80 colors across 8 categories (Reds, Oranges, Yellows, Greens, Blues, Purples, Pinks, Grays)
- Adjust opacity from 0% to 100% with preset values
- Search colors by name, hex, or category
- Copy colors in multiple formats:
  - Hex (with or without alpha)
  - RGBA
  - RGB
  - CSS Variables
  - Tailwind classes

**Usage:**
1. Open Vicinae and search for "Tailwind Colors"
2. Browse colors by category or search for specific colors
3. Adjust opacity using the dropdown in the search bar
4. Select a color and choose a copy action

**Keyboard Shortcuts:**
- **Enter**: Copy Hex code
- **Cmd+C**: Copy Hex code

### 2. Hex Opacity Converter

Convert opacity percentages to hex alpha values.

**Features:**
- Enter any opacity percentage (0-100)
- Get the hex alpha value instantly
- Quick reference actions for common opacity values
- Copy in multiple formats (hex, with hash, decimal)
- See example usage with colors

**Usage:**
1. Open Vicinae and search for "Hex Opacity Converter"
2. Enter an opacity percentage (e.g., "20" for 20%)
3. Copy the hex value or see examples of usage

**Quick Reference:**
- 100% = FF
- 95% = F2
- 90% = E6
- 85% = D9
- 80% = CC
- 75% = BF
- 50% = 80
- 25% = 40
- 0% = 00

## Development

```bash
# Install dependencies
npm install

# Build extension
npm run build

# Develop with hot reload
npm run dev

# Lint
npm run lint
```

## License

MIT
