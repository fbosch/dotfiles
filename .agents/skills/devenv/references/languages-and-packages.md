# Languages And Packages

Prefer language modules for toolchains and ecosystem integration. Prefer `packages` for standalone CLIs and native libraries.

## Universal Pattern

```nix
{
  languages.<name>.enable = true;
}
```

Common optional suboptions include `package`, `version`, `lsp.enable`, `lsp.package`, `directory`, and language-specific package manager options. Search exact options before adding suboptions.

## Supported Language Names

`ansible`, `c`, `clojure`, `cplusplus`, `crystal`, `cue`, `dart`, `deno`, `dotnet`, `elixir`, `elm`, `erlang`, `fortran`, `gawk`, `gleam`, `go`, `hare`, `haskell`, `helm`, `idris`, `java`, `javascript`, `jsonnet`, `julia`, `kotlin`, `lean4`, `lobster`, `lua`, `nim`, `nix`, `ocaml`, `odin`, `opentofu`, `pascal`, `perl`, `php`, `pkl`, `purescript`, `python`, `r`, `racket`, `raku`, `robotframework`, `ruby`, `rust`, `scala`, `shell`, `solidity`, `standardml`, `swift`, `terraform`, `texlive`, `typescript`, `typst`, `unison`, `v`, `vala`, `zig`.

## Python

```nix
{
  languages.python = {
    enable = true;
    venv.enable = true;
  };
}
```

Specific Python versions require `nixpkgs-python` input:

```yaml
inputs:
  nixpkgs-python:
    url: github:cachix/nixpkgs-python
    inputs:
      nixpkgs:
        follows: nixpkgs
```

```nix
{
  languages.python = {
    enable = true;
    version = "3.11";
  };
}
```

For project subdirectories:

```nix
{
  languages.python = {
    enable = true;
    directory = "./backend";
    venv.enable = true;
  };
}
```

For uv:

```nix
{
  languages.python = {
    enable = true;
    venv.enable = true;
    uv = {
      enable = true;
      sync.enable = true;
    };
  };
}
```

For Poetry:

```nix
{
  languages.python = {
    enable = true;
    poetry = {
      enable = true;
      install.enable = true;
      activate.enable = true;
    };
  };
}
```

Pitfalls:

- `poetry.install` and `uv.sync` are mutually exclusive.
- `directory` changes where `pyproject.toml`, `requirements.txt`, and `poetry.lock` are read.
- The `$DEVENV_STATE/venv` virtualenv is recreated when the interpreter changes.
- Add native libraries to `packages` when Python packages need C libraries, e.g. `pkgs.cairo`, `pkgs.zlib`.

## Rust

```nix
{
  languages.rust = {
    enable = true;
    channel = "stable";
    version = "1.81.0";
  };
}
```

Use `toolchainFile` when the repo has `rust-toolchain.toml`:

```nix
{
  languages.rust = {
    enable = true;
    toolchainFile = ./rust-toolchain.toml;
  };
}
```

Pitfalls:

- Default `channel = "nixpkgs"` is limited to the Rust version in pinned nixpkgs.
- `version` only works for non-`nixpkgs` channels.
- `toolchainFile` cannot be combined with manual `channel` or `version` configuration.
- Cranelift requires nightly.

## JavaScript And TypeScript

```nix
{
  languages.javascript = {
    enable = true;
    corepack.enable = true;
  };

  languages.typescript.enable = true;
}
```

Useful JavaScript options include `package`, `directory`, `bun.enable`, `bun.install.enable`, `corepack.enable`, and LSP settings. TypeScript LSP defaults to enabled with `pkgs.typescript-language-server`.

## Go

```nix
{
  languages.go = {
    enable = true;
    version = "1.22";
  };
}
```

Go LSP defaults to enabled with `gopls`. Delve defaults to enabled; `enableHardeningWorkaround` exists for Delve debugger hardening issues.

## Nix

```nix
{
  languages.nix.enable = true;
}
```

Nix LSP defaults to enabled with `pkgs.nixd`. For `devenv.nix` itself, `devenv lsp` provides a preconfigured nixd server.

## Terraform And OpenTofu

Use `languages.terraform` or `languages.opentofu`. Terraform `version` auto-sets the package via `nixpkgs-terraform`; search exact options before pinning.

## Package Discovery

Run:

```bash
devenv search <package-or-option-term>
```

For package containing a file, use nix-index database if needed:

```bash
nix run github:nix-community/nix-index-database <filename>
```

When a package needs a different nixpkgs revision, add another input and import it explicitly; do not blindly update the main lockfile.
