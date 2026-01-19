# Compliance and Structure

Official resources:

- Extensions store: https://github.com/vicinaehq/extensions
- Documentation: https://docs.vicinae.com/extensions/introduction
- API reference: https://api-reference.vicinae.com
- Guidelines: https://github.com/vicinaehq/extensions/blob/main/GUIDELINES.md

Required:

- Pass `pnpm exec vici lint`
- Directory name matches manifest `name`
- At least one command
- Clear `title` and `description`
- Use `@vicinae/api` as dependency
- Include `extension_icon.png` (512x512, 1:1)
- Generate lockfile via pnpm

Quality standards:

- User-friendly error handling
- Inform users about missing CLI tools
- No silent failures
- Avoid duplicating native Vicinae functionality

Security:

- Never download arbitrary binaries
- Exceptions require justification during review
- Prompt users to install required CLI tools

File structure:

```
extension-name/
  assets/
    extension_icon.png
  src/
    components/
    utils/
    extension-name.tsx
    types.ts
  package.json
  tsconfig.json
  vicinae-env.d.ts
  README.md
```
