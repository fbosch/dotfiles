# Integrations And CI

Use these patterns when wiring devenv into automation or shell activation.

## GitHub Actions

Install Nix and devenv before running devenv commands:

```yaml
steps:
- uses: actions/checkout@v5
- uses: cachix/install-nix-action@v31
- uses: cachix/cachix-action@v16
  with:
    name: devenv
- name: Install devenv.sh
  run: nix profile add nixpkgs#devenv
- name: Build the devenv shell and run hooks
  run: devenv test
```

Run one command inside the shell:

```yaml
- name: Run command in devenv shell
  run: devenv shell hello
```

Run multiline commands inside the shell:

```yaml
- name: Run multiline command in devenv shell
  shell: devenv shell bash -- -e {0}
  run: |
    hello
    say-bye
```

Pitfall: each GitHub Actions `run` step is a separate shell. Running `devenv shell` in one step does not affect later steps.

If `defaults.run.shell` uses devenv, force the install step to plain bash:

```yaml
defaults:
  run:
    shell: devenv shell bash -- -e {0}

steps:
- name: Install devenv.sh
  shell: bash
  run: nix profile add nixpkgs#devenv
```

## Git Hooks

```nix
{
  git-hooks.hooks = {
    shellcheck.enable = true;
    mdsh.enable = true;
    black.enable = true;
  };
}
```

Hooks install on `devenv shell`. Verify formatting/linting in CI with `devenv test`.

`.pre-commit-config.yaml` is a generated symlink into the Nix store; it need not be committed and is ignored by default after `devenv init`.

## Custom Git Hooks

```nix
{
  git-hooks.hooks.unit-tests = {
    enable = true;
    name = "Unit tests";
    entry = "make check";
    files = "\\.(c|h)$";
    language = "system";
    pass_filenames = false;
  };
}
```

Search `git-hooks.hooks.<name>` options for hook-specific settings.

## Treefmt

Add input:

```bash
devenv inputs add treefmt-nix github:numtide/treefmt-nix
```

Enable formatters:

```nix
{
  treefmt = {
    enable = true;
    config.programs = {
      nixfmt.enable = true;
      rustfmt.enable = true;
    };
  };
}
```

Optionally add treefmt to git hooks:

```nix
{
  git-hooks.hooks.treefmt.enable = true;
}
```

## Auto Activation

Prefer built-in `devenv hook` for most workflows.

```bash
eval "$(devenv hook bash)"
eval "$(devenv hook zsh)"
```

```fish
devenv hook fish | source
```

Trust a project before auto activation:

```bash
devenv allow
devenv revoke
```

Pitfall: auto activation detects projects with `devenv.yaml`; projects with only `devenv.nix` are not detected.

## Direnv

Use direnv only when in-place environment mutation is required instead of devenv's subshell activation.

`.envrc`:

```bash
#!/usr/bin/env bash
eval "$(devenv direnvrc)"
use devenv
```

`devenv init` does not create `.envrc` by default. Use `devenv init --include-envrc` when desired.

## Containers

Build/run predefined containers:

```bash
devenv container build shell
devenv container run shell
devenv container build processes
devenv container run processes
```

Generate a single process container:

```nix
{ config, ... }:

{
  processes.serve.exec = "python -m http.server";

  containers."serve" = {
    name = "myapp";
    startupCommand = config.processes.serve.exec;
  };
}
```

Copy to a registry:

```bash
devenv container --registry docker://ghcr.io/owner/ copy processes
```

Pitfall: generating containers on macOS requires a remote Linux builder.

## Devenv Container Image

Use the published container to run devenv in container-based CI:

```bash
docker run ghcr.io/cachix/devenv/devenv:latest devenv shell hello-world
```

GitLab CI example:

```yaml
devenv-job:
  image: ghcr.io/cachix/devenv/devenv:latest
  script: devenv shell hello-world
```
