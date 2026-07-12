# AGENTS

Keep functions as thin interactive UX wrappers. Put auth, HTTP, cache, JSON validation, and data transformations in `libexec/` Bun helpers.

Fish owns argument handling, terminal rendering, and interactive confirmation. Invoke helpers with `bun --cwd .config/fish/libexec`.
