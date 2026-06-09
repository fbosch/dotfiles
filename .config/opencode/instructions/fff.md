# FFF Search

Use the `fff` MCP tools for file search and content grep in git-indexed directories.

- Prefer `fffind` for path or filename search.
- Prefer `ffgrep` for content search.
- Prefer `fff-multi-grep` when searching several patterns at once.
- Fall back to built-in search tools when `fff` is unavailable, the target is outside a git-indexed tree, or exact tool semantics require it.
