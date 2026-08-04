# Scope Custom Daemon Sockets To Hyprland Instances

**Status:** accepted
**Date:** 2026-08-04

## Context

Several long-lived Hyprland helpers used global per-user Unix socket paths. A surviving or nested compositor instance could therefore satisfy a daemon health check while its command channel dispatched to another instance. Moving all paths beneath the instance directory also exposed the 107-byte Linux Unix-socket path limit.

## Decision

Scope custom daemon control sockets and their PID/lock files to `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/`. Construct them only through `runtime.lib.hypr-ipc` or `runtime/lib/hypr-ipc.sh`; socket-specific helpers reject paths longer than 107 bytes, so daemon socket names remain short.

## Alternatives Considered

Global per-user socket names were rejected because they collide across compositor instances and restarts. Encoding the signature in daemon health responses was rejected because it duplicates ownership logic at every consumer and still leaves path collisions. A separate global runtime directory per daemon was rejected because it does not share the compositor's existing instance boundary.

## Consequences

Waybar monitor, picture-in-picture, and custom-layout resize control channels now route only to their owning compositor instance. New daemon code must use the shared helpers, while cleanup still needs process-ownership checks. Desktop reset still manages application processes by name; changing that workflow requires explicit per-instance process ownership and cannot be solved by socket paths alone.
