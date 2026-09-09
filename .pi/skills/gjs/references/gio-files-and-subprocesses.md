# Gio Files And Subprocesses

## Read For

- Files, streams, directory enumeration, monitors, recursive operations, or subprocesses in GJS.

## Files

`Gio.File` represents a path or URI; creating it does not access or create the target. Prefer asynchronous operations for UI processes.

- Use `TextDecoder` for loaded byte arrays and `GLib.Bytes` for binary writes.
- Retain `Gio.FileMonitor` for as long as events are needed; an unreferenced monitor can be collected.
- Directory creation, recursive copy, and recursive deletion need explicit policies. Do not assume `copy()` or `delete()` recurse.
- Check URI, symlink, overwrite, cancellation, and error behavior before choosing an operation.
- Async iteration over `Gio.FileEnumerator` needs GJS 1.74 / GNOME 43 or newer.

## Subprocesses

Prefer `Gio.Subprocess` and an argv array over a shell command string.

- Starting successfully does not mean the program exited successfully. Use `wait_check_async()` or inspect status.
- `communicate*_async()` buffers all output; use streams for large or long-lived output.
- Cancelling a wait cancels the wait, not necessarily the child process. Connect cancellation to `force_exit()` only when termination is intended.
- `GLib.shell_parse_argv()` handles argv-style quoting; it does not provide pipes, expansion, redirection, or shell semantics.
- Avoid `bash -c`, especially with untrusted input. Prefer D-Bus or direct argv invocation.

The upstream guide contains incomplete recursive and monitor examples. Apply the lifecycle rules above rather than copying those snippets verbatim.

Source basis: GJS Guide `guides/gio/file-operations.md` and `guides/gio/subprocesses.md`.
