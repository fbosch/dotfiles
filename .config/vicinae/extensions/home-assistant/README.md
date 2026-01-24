# Home Assistant

Control Home Assistant from Vicinae.

## Features

- List all `light.*` entities
- Toggle lights on/off
- View brightness and attributes
- Open Home Assistant in browser
- Copy entity IDs

## Setup

1. Create a long-lived access token in Home Assistant: Profile → Security → Long-Lived Access Tokens
2. Configure the extension preferences:
   - Home Assistant URL (e.g. `https://ha.example.com`)
   - Long-Lived Access Token

## Development

```bash
# Install dependencies
pnpm install

# Build extension
pnpm run build

# Develop with hot reload
pnpm run dev

# Lint
pnpm run lint
```
