# Sandbox inspection

`/sandbox` reports the effective nono capabilities that Pi parses from `NONO_CAP_FILE`.

- `/sandbox` summarizes writable roots, read-only grants, denied paths, exceptions,
  command lists, and network settings.
- `/sandbox list <write|read|denied|exceptions|commands|domains>` prints one section in full.
- `/sandbox explain <path> [read|write]` reports whether the path is granted, denied, or
  not covered. Write is the default. Relative paths use the working directory, and symlinks
  resolve before the lookup.

The output describes declared capabilities. It does not verify kernel confinement, and a
grant does not override command or deny rules. If Pi runs without nono, or the metadata is
unreadable, the command reports that and exits.

## Agent context

With valid capability metadata, the extension adds a `sandbox_context` system-prompt
section before agent runs. It summarizes grants, denied-path and exception counts,
network metadata, and permission-failure guidance. Paths are encoded as data.
The prompt does not claim that command-list metadata is enforced.

The summary uses one snapshot per session and refreshes on session start or reload.
A named section prevents duplicate injection and preserves other extensions' sections.
Missing or invalid metadata adds no section or startup warning.

The rendered section is limited to 1,400 UTF-8 bytes, including its tags. Redundant
descendant grants collapse into their existing parent grant, and omitted entries are
counted. Paths are never cut in half. At characters divided by four, the live profile
measures about 350 tokens. This is an estimate, not a provider-tokenizer measurement
or a guaranteed 500-token cap. No tool schema is added. Read the file named by
`NONO_CAP_FILE` for complete grants; `/sandbox` remains a user command.
