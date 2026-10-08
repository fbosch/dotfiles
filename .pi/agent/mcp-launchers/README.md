# MCP workspace containers

`ast-grep` and `serena` use `workspace.py` to copy a filtered snapshot of the
launch directory into a private cache, then mount only that copy read-only.
Pi edits the live project; these MCPs do not. Context7 and browser launchers
are unchanged.

## Refresh and include files

1. Start Pi inside the Git working directory you want to expose. Only that
   directory's subtree is copied, not the whole repository above it.
2. Use `/mcp reconnect ast-grep` or `/mcp reconnect serena` after host edits.
   Snapshots contain current working-tree contents, including unstaged edits,
   but stay unchanged until reconnect.
3. To expose an untracked file, add `"--include", "src/new-file.ts"` to that
   server's `args` in `../mcp.json`, then `/reload`. Repeat for each file.
   Paths are relative to Pi's launch directory; directories and globs are not
   accepted. Remove project-specific arguments before using another project.

## File policy

Git-tracked regular files are candidates, not proof that their contents are
safe. `workspace.py` excludes known credential names, `.env*`, private-key
formats, live shell startup files, Git metadata, dependency/cache directories
and Pi runtime state. Exclusions also apply to explicit includes. Symlinks
(including symlinked parent directories) are not followed; hardlinks are
rejected. The launcher never falls back to mounting the live directory.

**This is not a secret scanner.** A token embedded in an otherwise allowed
source file is still copied. Keep secrets out of source and extend the deny
sets in `workspace.py` when introducing another credential/runtime location.
Keep exclusion tests in `__tests__/test_workspace.py` alongside policy changes.

## Container boundaries and limits

- ast-grep sees `/src` read-only, has no network and a read-only container root.
- Serena sees `/workspace` read-only and starts in project read-only mode.
  Its `.serena` metadata uses a separate writable tmpfs. Global config is fresh
  per container; the old `pi-serena` volume is neither mounted nor deleted.
  Serena retains networking and a writable container root for language servers.
- Both retain dropped capabilities and `no-new-privileges`.
- Snapshots live under `~/.cache/pi/mcp-workspaces` so macOS Podman machines can
  access them. Normal exit and handled signals remove them; SIGKILL or a crash
  can leave private stale snapshots. No background cleanup service is installed.
- Limits: 32 MiB per file, 512 MiB total and 100,000 candidate files. Missing
  Git metadata, index conflicts, empty selections and unsafe explicit includes
  fail closed.
- Ignored/untracked files, submodules and symlink targets are absent unless
  eligible regular files are explicitly included. Missing dependencies can
  reduce language-server resolution. Serena caches and memories reset on reconnect.

Requires Python 3.10+, Git and Podman. Run the registered
`test:pi-mcp-workspace` task through `devenv test` for policy, fake-Podman
launcher and shell checks. Real-container startup still needs a smoke test on
the target host; mocked arguments do not establish kernel mount enforcement.
