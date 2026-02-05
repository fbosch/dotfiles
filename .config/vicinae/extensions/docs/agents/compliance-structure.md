# Compliance and Structure

Primary references (use these for canonical requirements):

- Manifest: docs/agents/references/manifest
- File structure: docs/agents/references/file-structure
- Official guidelines: https://github.com/vicinaehq/extensions/blob/main/GUIDELINES.md

Repo-specific requirements and deltas:

- Must pass `pnpm exec vici lint` before submitting.
- Keep directory name equal to manifest `name`.
- Keep `extension_icon.png` (512x512, 1:1) in `assets/`.
- Use `@vicinae/api` as a dependency; generate lockfile via pnpm.
- Prefer clear error toasts and explicit instructions for missing CLI tools.
- Avoid duplicating native Vicinae functionality.
