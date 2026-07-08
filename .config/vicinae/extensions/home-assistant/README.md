# Home Assistant

Control Home Assistant from Vicinae.

## Command

`Lights` lists `light.*` entities, shows relevant attributes, and provides actions for toggling lights, opening Home Assistant, and copying entity IDs.

## Setup

1. Create a long-lived access token in Home Assistant: Profile → Security → Long-Lived Access Tokens
2. Configure the extension preferences:
   - Home Assistant URL, for example `https://ha.example.com`
   - Long-Lived Access Token

The token is stored as a Vicinae password preference. Do not commit it to this repo.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build
```
