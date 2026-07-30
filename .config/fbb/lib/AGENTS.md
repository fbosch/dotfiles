# FBB Libraries

## Terminal Output

- Treat `--format json` as the stable automation interface. Keep it free of ANSI sequences, prompts, and decorative layout.
- Text output may use ANSI styling only when stdout is a TTY. Apply styles after calculating visible widths; never pad styled strings.
- Prefer compact account cards for quota data. Put identity and active state first, then one progress line per quota window with its reset countdown.
- Use `progress-bar.ts`'s `renderProgressBar` for percentage bars. It returns full, half-cell, and empty thin-line geometry; use `filledProgressCells` and `emptyProgressCells` to render its cells. Do not add decorative brackets around the rendered bar.
- Render filled `━` cells and the `╸` half-cell green above 50%, yellow above 20%, and red otherwise. Render empty `─` cells and reset countdown dim.
- Preserve output alignment with ANSI-aware rendering. Test both a TTY and redirected stdout whenever changing terminal presentation.
