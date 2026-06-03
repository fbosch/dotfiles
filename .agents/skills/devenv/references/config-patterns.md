# Config Patterns

Use small composable snippets. Preserve existing project style when editing.

## Minimal devenv.nix

```nix
{ pkgs, ... }:

{
  env.GREET = "hello";
  packages = [ pkgs.jq ];

  enterShell = ''
    echo $GREET
    jq --version
  '';
}
```

Prefer a task hooked to `devenv:enterShell` when setup grows beyond simple messages/env checks.

## Packages

```nix
{ pkgs, ... }:

{
  packages = [
    pkgs.git
    pkgs.jq
    pkgs.libffi
    pkgs.zlib
  ];
}
```

Use `devenv search <name>` before adding unfamiliar package attrs.

## Scripts

Use scripts for user-invoked helper commands exposed inside `devenv shell`.

```nix
{ pkgs, ... }:

{
  scripts.analyze-json = {
    exec = ''
      curl "https://httpbin.org/get?$1" | jq '.args'
    '';
    packages = [ pkgs.curl pkgs.jq ];
    description = "Fetch and analyze JSON";
  };
}
```

Use script-local `packages` to avoid polluting global PATH.

## Tasks For Shell Or Test Setup

```nix
{
  tasks."setup:hello" = {
    exec = "echo hello";
    before = [ "devenv:enterShell" ];
  };

  tasks."test:fixtures" = {
    exec = "echo preparing fixtures";
    before = [ "devenv:enterTest" ];
  };
}
```

Use tasks for ordering, dependencies, caching, and parallel execution.

## Tests

```nix
{ pkgs, ... }:

{
  packages = [ pkgs.ncdu ];

  enterTest = ''
    ncdu --version | grep "ncdu"
  '';
}
```

If processes are defined, `devenv test` starts and stops them. `enterTest` has `wait_for_port <port> <timeout>`.

## Files

Generate project files from Nix data when reproducibility matters.

```nix
{
  files."config.json".json = {
    database = {
      host = "localhost";
      port = 5432;
    };
  };

  files."scripts/setup.sh" = {
    text = ''
      #!/usr/bin/env bash
      echo setup
    '';
    executable = true;
  };
}
```

Supported formats: `json`, `yaml`, `toml`, `ini`, `text`.

## Inputs

`devenv.yaml` declares external Nix inputs and passes them to `devenv.nix`.

```yaml
inputs:
  nixpkgs-stable:
    url: github:NixOS/nixpkgs/nixos-23.11
```

```nix
{ inputs, pkgs, ... }:

let
  pkgs-stable = import inputs.nixpkgs-stable { system = pkgs.stdenv.system; };
in {
  packages = [ pkgs-stable.git ];
}
```

Use `follows` to reuse/override nested inputs:

```yaml
inputs:
  nixpkgs:
    url: github:cachix/devenv-nixpkgs/rolling
  git-hooks:
    url: github:cachix/git-hooks.nix
    inputs:
      nixpkgs:
        follows: nixpkgs
```

Pitfall: `path:` inputs copy whole directories and ignore `.gitignore`; prefer `git+file:///path/to/repo` for large local repos.

## Imports

Compose local environments in `devenv.yaml`:

```yaml
imports:
- ./frontend
- ./backend
```

Entering a subdirectory activates that sub-env; top-level combines imported envs. Remote `devenv.yaml` imports are not supported.

## Outputs

```nix
{ config, ... }:

{
  languages.rust.enable = true;
  languages.python.enable = true;

  outputs = {
    rust-app = config.languages.rust.import ./rust-app {};
    python-app = config.languages.python.import ./python-app {};
  };
}
```

Build with `devenv build` or `devenv build outputs.<name>`.

## Ad-Hoc Environments

Use `--option` for one-off testing without editing files:

```bash
devenv --option languages.python.enable:bool true --option languages.python.version:string "3.11" shell
devenv --option packages:pkgs "ncdu git ripgrep" shell
devenv -O packages:pkgs! "ncdu git" shell
```

Types include `:string`, `:int`, `:float`, `:bool`, `:path`, `:pkg`, `:pkgs`. Add `!` to replace list values instead of appending.
