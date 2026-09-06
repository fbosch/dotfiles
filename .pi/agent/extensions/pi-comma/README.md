# pi-comma

`pi-comma` lets Pi's built-in local `bash` tool recover a missing bare executable
through [comma](https://github.com/nix-community/comma).

This directory follows the existing extension collection's `*/index.ts`
discovery convention. Keep `ambiguous-picker.sh` executable beside `index.ts`;
there is no separate package, configuration, or dependency installation.
The integration targets Pi 0.85.1 and comma 2.4.1 on Linux and macOS with
Bash, Nix, and a configured nix-index database. Fish or Zsh as the interactive
shell does not disable Pi's Bash tool.

Pi imports this module during extension discovery. It registers no hook unless
all of these availability checks pass on each startup or `/reload`:

- the host is Linux or macOS; and
- `comma` is executable on inherited `PATH` and `comma --version` exits zero
  within one second.

When a `bash` tool call occurs, the extension uses Pi's documented tool
provenance and CLI process marker to confirm that the tool is Pi's built-in
local Bash before mutating the command. It also supports this configuration's
local `direnv` Bash wrapper, identified only by the canonical path of its
sibling `extensions/direnv/index.ts`; that wrapper retains Pi's local Bash
runner while adding the project environment. SDK-provided and all other custom
backends remain excluded.

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
are printed to stderr (up to ten candidates, each limited to 512 characters),
and none is selected. Choose a provider by running comma yourself, then retry
in Pi. With comma's default cache level, subsequent calls can reuse the same
executable version until comma invalidates it or you manage its cache yourself.
pi-comma does not force fresh discovery or upgrades.
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
pi-comma does not refresh indexes, install packages, or repair caches. Configure
or update a missing index yourself before retrying. Comma's package sources,
database location, and cache settings remain unchanged.

The resolver uses `--print-path --picker <bundled-picker> -- <command>` from
[comma 2.4.1](https://github.com/nix-community/comma/blob/v2.4.1/src/main.rs).
That version can print `/bin/<command>` after a failed Nix build, so a zero
comma exit status alone is insufficient: pi-comma also rejects output outside
`/nix/store`, malformed output, and unavailable executables.

Only the normal Pi CLI built-in local Bash tool and the local `direnv`
wrapper described above are supported. Other custom Bash backends, SDK
embeddings, SSH/container/sandbox backends, nested shells, `sudo`, and `env`
are out of scope. Bash `exec` also bypasses its command-not-found handler.
Recovery is not exported to subprocesses. All recovery processes stay within
Pi's existing timeout/cancellation boundary. Other extensions' permission
checks still apply to the prefixed command; pi-comma does not bypass them.
The extension does not poll, create persistent state, install comma, or modify
shell startup files.

## Tests

Ordinary tests use temporary fake comma and Nix-store fixtures; they need no
Nix, comma, network access, or downloads:

```sh
cd ~/.pi/agent
bun test extensions/pi-comma/__tests__
```

An opt-in real-comma smoke test exercises the actual Bash handler. Pass a known
bare executable name absent from PATH but present in your configured comma
database. It requires Bun and may download or build software. It is intentionally
excluded from the ordinary suite:

```sh
cd ~/.pi/agent/extensions/pi-comma
./smoke-real-comma.sh <known-command> [arguments...]
```

The ordinary tests exercise the handler with temporary executables, including
malformed resolver output, argument/stdin preservation, and Pi's normal runner
cancellation. They are also discovered by the existing `devenv test` workflow.
Real-comma resolution and macOS execution must be checked separately; unit tests
do not establish those results.
