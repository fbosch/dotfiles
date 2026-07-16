# AGENTS

- Keep the Neovim bridge bound to its configured socket and fail closed; never discover or accept an alternative socket.
- Preserve the curated read-only tool contracts. Internal Lua must be fixed and bridge-owned, never caller-supplied.
- Treat RPC count and response payload as hot paths. Prefer fixed aggregate snapshots to per-buffer or per-window proxy calls.
- For performance changes, measure before and after with the package benchmark. Report latency, RPCs per operation, decoded payload bytes, and timeout lifecycle; optimize one candidate at a time.
