# pi-comma

`pi-comma` lets Pi's built-in local `bash` tool recover a missing bare executable
through [comma](https://github.com/nix-community/comma).

Pi imports this module during extension discovery. It remains silent and registers
no hook unless all of these checks pass on each startup or `/reload`:

- the host is Linux or macOS;
- Pi identifies the configured `bash` tool as its built-in tool; and
- `comma` is executable on inherited `PATH` and `comma --version` exits zero
  within one second.

The built-in-tool check uses Pi's documented tool provenance and CLI process
marker. The extension deliberately does not run for SDK-provided or custom
backends because Pi exposes no supported backend-identity API for them.

## Behavior

The extension prepends a per-invocation Bash setup fragment. Its
`command_not_found_handle` calls comma with `--print-path` and the bundled
non-interactive picker. It preserves the original command text and recovers at
the point Bash reports the missing executable, so earlier compound-command work
is not replayed.

Existing commands, builtins, functions, permission errors, explicit paths, and
commands that themselves return 127 do not invoke comma. If Bash already has a
`command_not_found_handle`, that handler remains in control. User `!` commands
are unchanged.

Comma keeps provider discovery and its own cache. A cached or unique provider
runs from its validated `/nix/store/...` executable path. Ambiguous providers
are printed to stderr (up to ten candidates), and none is selected.
`COMMA_ASK_TO_CONFIRM` is reported rather than bypassed. Resolver diagnostics go
to stderr; comma receives `/dev/null`, so the missing command's stdin remains
available to the resolved executable.

`--print-path` can download or build software. This is ephemeral execution: it
does not install a profile package, but it uses the Nix store and comma/Nix
caches. It is not a security sandbox or a replacement for declared project
dependencies.

## Troubleshooting and boundaries

Install and configure comma and its index using comma's documentation. A missing
index, failed build, invalid path, or vanished executable fails clearly;
pi-comma does not refresh indexes, install packages, or repair caches.

Only the normal Pi CLI built-in local Bash tool is supported. Custom Bash
backends, SDK embeddings, SSH/container/sandbox backends, nested shells,
`sudo`, and `env` are out of scope. The extension does not poll, create
persistent state, install comma, or modify shell startup files.

## Tests

Ordinary tests use temporary fake comma and Nix-store fixtures; they need no
Nix, comma, network access, or downloads:

```sh
cd ~/.pi/agent
bun test extensions/pi-comma/__tests__
```

An opt-in real-comma smoke test exercises the actual Bash handler. Pass a known
bare executable name in your configured comma database; it may download or build
software and is intentionally excluded from the ordinary suite:

```sh
cd ~/.pi/agent/extensions/pi-comma
./smoke-real-comma.sh <known-command> [arguments...]
```
