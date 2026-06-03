# Commands And Discovery

Use these commands to discover facts from the current project and pinned inputs instead of relying on stale package or option memory.

## Command Map

| Command | Use |
|---|---|
| `devenv init` | Scaffold `devenv.nix`, `devenv.yaml`, `.gitignore`. |
| `devenv shell` | Enter the environment. |
| `devenv shell <cmd>` | Run one command inside the environment. Useful in CI and agents. |
| `devenv test` | Build the environment, run `enterTest`, run git hooks, and start/stop defined processes for tests. |
| `devenv search <term>` | Search packages and devenv options in the pinned nixpkgs/input set. |
| `devenv update` | Update and pin inputs into `devenv.lock`; avoid unless requested or required. |
| `devenv up` | Start processes and services in the foreground. |
| `devenv up -d` | Start processes and services detached. |
| `devenv up --mode all` | Include downstream process setup tasks that default `devenv up` skips. |
| `devenv processes wait --timeout 120` | Wait for readiness probes; useful after detached startup. |
| `devenv down` | Stop detached processes; shorthand for `devenv processes down`. |
| `devenv tasks run <task>` | Run a task and its selected dependency graph. |
| `devenv build` | Build all outputs. |
| `devenv build outputs.<name>` | Build one output. |
| `devenv eval <attr>` | Evaluate an attr and print JSON. |
| `devenv repl` | Inspect config/options/packages/inputs interactively. |
| `devenv info` | Print resolved environment summary. |
| `devenv lsp` | Start bundled nixd configured for `devenv.nix`. |
| `devenv lsp --print-config` | Print generated nixd config. |
| `devenv mcp` | Start MCP server over stdio for AI tools. |
| `devenv mcp --http [port]` | Start MCP server over HTTP; default port 8080. |

## Discovery Order

1. For packages, run `devenv search <term>` first; it searches the pinned nixpkgs version in `devenv.lock`.
2. For devenv options, use `devenv search <term>` or MCP `search_options`.
3. For precise option metadata, search generated docs by heading: `## option.path` in `reference/options.md` or `reference/yaml-options.md`.
4. For evaluated values, use `devenv eval <attr>` or `devenv repl`.
5. For editor completions and hover docs, configure the Nix LSP command as `devenv lsp`.

## MCP Tools

`devenv mcp` exposes:

- `search_packages`: search packages in the pinned nixpkgs input.
- `search_options`: search devenv configuration options.

Prefer MCP search when the current agent environment has the MCP server available; fallback to CLI search.

## Generated References

- `reference/options.md`: `devenv.nix` module options. Large generated file; search headings like `## services.postgres.enable` or `## languages.python.uv.sync.enable`.
- `reference/yaml-options.md`: `devenv.yaml` keys such as `inputs`, `imports`, `nixpkgs.allow_unfree`, `profile`, `reload`, `require_version`, `strict_ports`.
- `devenv.schema.json`: JSON Schema for `devenv.yaml`; useful for editor/schema validation, not for `devenv.nix` options.

## Validation Routing

| Change | Validate With |
|---|---|
| Packages, env vars, languages, scripts | `devenv test` or `devenv shell <cmd>` |
| Git hooks | `devenv test` |
| Tasks | `devenv tasks run <task>` and often `devenv test` |
| Processes/services | `devenv up -d`, `devenv processes wait --timeout 120`, smoke command, `devenv down` |
| Outputs | `devenv build` or `devenv build outputs.<name>` |
| CI examples | run relevant workflow command locally where possible, usually `devenv test` |
