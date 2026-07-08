# Wallhaven

Vicinae extension for searching [Wallhaven](https://wallhaven.cc), previewing results, downloading wallpapers, and applying them through `hyprpaper`.

## Command

`Search for Wallpapers` searches Wallhaven, shows paginated grid results, and appends more results through the `Load More` item.

## Preferences

- Optional API key from <https://wallhaven.cc/settings/account>.
- Use Wallhaven account settings when an API key is configured.
- Content purity filter. NSFW results require a valid API key.
- Default sorting and top-list range.
- Download directory, default `~/Pictures/Wallpapers`.
- Hyprpaper config path for download-and-apply, default `~/.config/hypr/hyprpaper.conf`.

## Actions

- `Enter` opens the full preview.
- Save/download writes the image to the configured directory.
- `Cmd+S` downloads and applies the wallpaper through hyprpaper.
- Open opens the Wallhaven page in the browser.
- Copy actions copy image and page URLs.
- `Cmd+Shift+S` opens Wallhaven settings.
- `Enter` on `Load More` appends the next page.

## API Notes

- The extension uses `https://wallhaven.cc/api/v1`.
- Wallhaven rate limit is 45 requests per minute.
- Search input is debounced and results are cached in Vicinae cache storage.
- API keys must not be logged, shown in errors, or committed.

## Troubleshooting

- `401`: check the API key, especially for NSFW searches.
- `429`: slow down requests or wait for the Wallhaven rate-limit window to reset.
- Downloads fail: check filesystem permissions and the configured download directory.
- Download-and-apply fails: check `hyprpaper` and the configured `hyprpaper.conf` path.

## Development

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build
```
