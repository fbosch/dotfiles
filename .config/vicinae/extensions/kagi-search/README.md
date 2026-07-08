# Kagi Search

Search Kagi from Vicinae using a Kagi session link.

## Command

`Search Kagi` shows result titles, snippets, links, and related searches. Actions open results in the browser or copy result data.

## Setup

1. Visit [Kagi Settings - User Details](https://kagi.com/settings/user_details)
2. Copy the full session link URL, for example `https://kagi.com/?token=...`.
3. Paste it into the `Kagi Session Link` extension preference.

The extension extracts the token from the URL. Session tokens can expire; refresh the preference when Kagi rejects it.

## Usage

1. Run `Search Kagi` from Vicinae.
2. Enter a search query.
3. Press `Enter` to open a selected result.
4. Use `Cmd+C` to copy the URL or `Cmd+Shift+C` to copy the title.

## Notes

- This uses session-token authentication against Kagi's web interface, not the paid API.
- Account-level Kagi settings still apply.
- The token is a secret; keep it in Vicinae preferences and out of repo files.

## Troubleshooting

- `Invalid or expired session token`: generate a new session link in Kagi settings and update the preference.
- No results: check the token, network connection, and query.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build
```
