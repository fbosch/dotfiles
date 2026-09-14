# AGENTS

Keep functions as thin interactive UX wrappers. Put auth, HTTP, cache, JSON validation, and data transformations in `libexec/` Bun helpers.

Fish owns argument handling, terminal rendering, and interactive confirmation. Resolve helper paths from the function's own installed path; do not assume the caller's working directory or use relative helper paths. Invoke helpers with `bun --cwd "$libexec_dir"`. When a helper inspects the caller's repository, pass the original `$PWD` through `FISH_LIBEXEC_CWD` while keeping Bun's runtime cwd at `libexec_dir`.
