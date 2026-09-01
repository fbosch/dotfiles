# Code Search

- Use `fffind` for indexed path discovery and `ffgrep` for identifier or
  literal-text searches in Git repositories. Search one bare identifier at a
  time, then read the source once the relevant paths are known.
- Use Pi's configured ast-grep MCP server for syntax-aware searches over code
  structure and relationships. Keep structural searches read-only, narrowly
  scoped, and output-limited.
- Use Pi's built-in `find` and `grep` only when FFF is unavailable or the target
  is outside its supported scope.
