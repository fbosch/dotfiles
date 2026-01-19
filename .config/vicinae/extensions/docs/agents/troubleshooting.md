# Troubleshooting

Extension not appearing:

- Build with `./scripts/vicinae-build-extensions.sh`
- Check build errors
- Restart Vicinae

TypeScript errors:

- Ensure `vicinae-env.d.ts` exists
- Run `pnpm install` in extension directory
- Check `@vicinae/api` version

Actions not triggering:

- Verify shortcut conflicts
- Check console for errors
- Ensure callbacks are async
