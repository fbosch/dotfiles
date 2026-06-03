---
name: devenv
description: Use when creating, editing, reviewing, or troubleshooting devenv.sh developer environments, including devenv.nix, devenv.yaml, packages, languages, services, tasks, scripts, processes, tests, GitHub Actions, containers, MCP/LSP integration, or reproducible Nix-based project setup. Also use when an agent needs to discover devenv options/packages, validate environment changes with devenv test, or decide between tasks/scripts/processes/services.
---

# Devenv

Use devenv as a reproducible project-local development environment: declare tools and behavior in `devenv.nix`, declare inputs/imports in `devenv.yaml`, and validate changes with devenv commands instead of guessing from Nix memory.

## Core Workflow

1. Inspect existing `devenv.nix`, `devenv.yaml`, and repo task conventions before editing.
2. Use discovery before inventing names: `devenv search <term>`, `devenv mcp` tools, `devenv lsp`, `devenv repl`, or generated option refs.
3. Make the smallest config change in the right layer.
4. Validate with `devenv test` when feasible; for services/processes, use `devenv up`, `devenv processes wait --timeout 120`, then `devenv down`.
5. Report exact commands run and any skipped validation.

## Reference Routing

- For CLI/package/option discovery or validation planning: read `references/commands-and-discovery.md`; do not load integration or language refs unless the task touches them.
- For basic `devenv.nix`/`devenv.yaml` authoring, inputs, imports, files, outputs, or ad-hoc envs: read `references/config-patterns.md`.
- For tasks, processes, services, readiness, ports, or long-running dev dependencies: read `references/tasks-processes-services.md`; this is mandatory before changing process/service dependency graphs.
- For language toolchains, package managers, runtime versions, or native library issues: read `references/languages-and-packages.md`; do not load service refs unless runtime services are involved.
- For GitHub Actions, git hooks, treefmt, auto activation, direnv, or containers: read `references/integrations-and-ci.md`; do not load language/service refs unless examples require them.

## Mental Model

- `devenv.nix`: Nix module config for packages, languages, scripts, tasks, processes, services, tests, files, outputs, env vars.
- `devenv.yaml`: inputs, imports, nixpkgs policy, profile/reload/strict port settings.
- `devenv.lock`: pinned input revisions for reproducibility; update with `devenv update` only when requested or needed.
- `pkgs`, `lib`, `config`, `inputs`, and `...` are common `devenv.nix` function args; `config` is the resolved environment config.

## Choose The Right Feature

| Need | Use |
|---|---|
| Add tools or native libraries | `packages = [ pkgs.<name> ];` |
| Enable a language runtime/toolchain | `languages.<name>.enable = true;` |
| Add a user-invoked helper command | `scripts.<name>` |
| Add ordered setup/build/check automation | `tasks."namespace:name"` |
| Run long-lived custom commands | `processes.<name>` |
| Run known databases/brokers/proxies | `services.<name>` |
| Generate config files from Nix data | `files."path".<format>` |
| Validate shell/hooks/process test setup | `devenv test` |
| Build artifacts/packages | `outputs` plus `devenv build` |

## Command Defaults

```bash
devenv init                         # scaffold devenv.nix, devenv.yaml, .gitignore
devenv shell                        # enter environment
devenv shell <cmd>                  # run one command inside environment
devenv test                         # build env, run enterTest/git hooks, start/stop processes
devenv search <term>                # search packages and options for pinned inputs
devenv up [-d] [--mode all]         # start processes/services
devenv processes wait --timeout 120 # wait for readiness in CI/scripts
devenv down                         # stop detached processes/services
devenv tasks run <task>             # run task graph
devenv eval <attr>                  # evaluate attr as JSON
devenv repl                         # inspect evaluated config interactively
devenv lsp                          # nixd for devenv.nix
devenv mcp                          # MCP server with package/option search
```

## Never / Prefer Rules

- Never update `devenv.lock` casually; run `devenv update` only when requested or when an input change requires repinning.
- Never invent option or package names from memory; search first with `devenv search`, MCP, LSP, REPL, or generated refs.
- Never use complex `enterShell` or `enterTest` for ordered setup; prefer tasks because they model ordering, caching, dependencies, and parallelism.
- Never assume `devenv up` runs downstream setup tasks; it uses `before` mode. Use `devenv up --mode all` when setup/configure tasks depend on processes.
- Never expect service first-init options to reapply automatically; service state persists under `$DEVENV_STATE` and may need targeted state deletion.
- Never set `processes.<name>.watch.paths` relative to process `cwd`; paths resolve relative to `devenv.nix`, so prefer path literals like `./src`.
- Never rely on implicit port increments when fixed ports matter; use `strict_ports: true` or `devenv up --strict-ports`.
- Never expect GitHub Actions shell state to persist across steps; use `devenv shell <cmd>` or `shell: devenv shell bash -- -e {0}`.
- Never assume `devenv init` creates `.envrc`; use `--include-envrc` only when direnv is desired. Prefer `devenv hook` unless in-place env mutation is required.
- Never use `path:` inputs for large local repos; they copy whole directories and ignore `.gitignore`. Prefer `git+file`.
- Never promise local macOS container generation without a remote Linux builder.

## Failure Routing

| Symptom | Likely Cause | Next Action |
|---|---|---|
| Option/package not found | wrong attr or stale memory | run `devenv search <term>`; then inspect generated option refs by heading if needed |
| `devenv test` fails before project tests | environment eval/build/hook issue | read failure output; use `devenv eval <attr>` or `devenv repl` for config-level diagnosis |
| Service/process starts but dependent task fails | readiness/dependency mode mismatch | read `tasks-processes-services.md`; add/adjust ready probe or run `devenv up --mode all` |
| Detached services hang in CI | readiness not reached or wrong port | use `devenv processes wait --timeout 120`; enable strict ports if deterministic binding matters |
| Service init change has no effect | persisted `$DEVENV_STATE` data | stop services and delete only the affected service state dir when user intent is clear |
| GitHub Actions command cannot find tool/env | each step has separate shell | wrap command with `devenv shell <cmd>` or set step shell to `devenv shell bash -- -e {0}` |
| Auto activation does nothing | no `devenv.yaml` or project not trusted | ensure `devenv.yaml` exists and run `devenv allow` |
| Container build fails on macOS | missing Linux builder | use remote Linux builder or build on Linux |

## Reference Files

- `references/commands-and-discovery.md`: CLI, MCP/LSP, generated option docs, search strategy.
- `references/config-patterns.md`: common `devenv.nix` and `devenv.yaml` snippets.
- `references/tasks-processes-services.md`: task graph semantics, process readiness, service categories.
- `references/languages-and-packages.md`: language enablement patterns and package/version pitfalls.
- `references/integrations-and-ci.md`: GitHub Actions, git hooks, treefmt, auto activation, direnv, containers.
