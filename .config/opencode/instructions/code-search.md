# Code Search

- Use native `fff` MCP tools directly for path, identifier, and literal-text search in git-indexed directories: `fffind` for paths, `ffgrep` for text, and `fff-multi-grep` for alternatives. Do not discover `fff` through Toolbox.
- Use the Toolbox `ast-grep` MCP server for syntax-aware searches over language constructs, AST relationships, and scoped code patterns.
- Keep ast-grep searches read-only, narrowly scoped, and output-limited. Do not use rewrite operations unless explicitly requested.
