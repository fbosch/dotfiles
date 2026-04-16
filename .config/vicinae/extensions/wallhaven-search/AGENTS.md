# AGENTS

Wallhaven API integration guidance for `wallhaven-search`.

## API Contract

- Base URL: `https://wallhaven.cc/api/v1`
- Endpoints used:
  - `GET /search`
  - `GET /w/:id`
  - `GET /settings?apikey=...`
- Authentication:
  - API key may be sent as `?apikey=<key>` (current extension behavior)
  - `X-API-Key` header is also supported by Wallhaven
- Rate limit: 45 requests/minute. Keep debounced search and cache behavior intact.
- NSFW access requires a valid API key. Invalid/missing key for NSFW returns `401`.

## Search Parameter Notes

- `categories` and `purity` are bitfields (`1` enabled, `0` disabled).
- `topRange` only applies when `sorting=toplist`.
- `random` sorting can return a `seed` in meta for stable pagination.
- Search/list responses are paginated (`24` per page).

## Implementation Rules

- Never log API keys or include them in toasts/errors.
- Build query strings with `URLSearchParams`.
- Treat `401` and `429` as user-facing failures with clear error messages.

## Commands

- `pnpm lint`
- `pnpm build`
