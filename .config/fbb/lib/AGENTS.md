# FBB Libraries

## TanStack Queries

- Put each query in `queryclient/queries/` and export a `*QueryOptions` factory.
- A query-options factory must not import or construct a `QueryClient`.
- Providers resolve credentials at the request boundary, then call the configured shared `QueryClient` directly with the query options.
- Treat access and refresh tokens as secrets: use them only to authorize requests; never put them in query keys, persisted query data, logs, errors, or terminal/JSON output. Use a stable non-secret account identifier, or its hash, for query keys.
- Configure persistence once in `queryclient/client.ts` through `QueryClient.defaultOptions.queries.persister`; do not manually persist successful queries.
- Keep related keys beneath `accountQueryKey` so account mutations can invalidate and remove all persisted account data together.

## Terminal Output

- Treat `--format json` as the stable automation interface. Keep it free of ANSI sequences, prompts, and decorative layout.
- Text output may use ANSI styling only when stdout is a TTY. Apply styles after calculating visible widths; never pad styled strings.
- Prefer compact account cards for quota data. Put identity and active state first, then one progress line per quota window with its reset countdown.
- Use `progress-bar.ts`'s `renderProgressBar` for percentage bars. It returns full, half-cell, and empty thin-line geometry; use `filledProgressCells` and `emptyProgressCells` to render its cells. Do not add decorative brackets around the rendered bar.
- Render filled `━` cells and the `╸` half-cell green above 50%, yellow above 20%, and red otherwise. Render empty `─` cells and reset countdown dim.
- Preserve output alignment with ANSI-aware rendering. Test both a TTY and redirected stdout whenever changing terminal presentation.
