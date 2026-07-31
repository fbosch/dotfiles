#!/usr/bin/env dash

# shellcheck disable=SC2154

daemon_supervisor_log() {
  printf '%s: %s\n' "$daemon_supervisor_name" "$1" >&2
}

daemon_supervisor_response() {
  [ -S "$daemon_supervisor_socket" ] || return 1
  printf 'ping\n' | timeout "$daemon_supervisor_health_timeout" nc -w 1 -U "$daemon_supervisor_socket" 2>/dev/null
}

daemon_supervisor_is_live() {
  [ "$(daemon_supervisor_response || true)" = "ok" ]
}

daemon_supervisor_socket_accepts_connections() {
  [ -S "$daemon_supervisor_socket" ] || return 1
  printf 'ping\n' | timeout "$daemon_supervisor_health_timeout" nc -w 1 -U "$daemon_supervisor_socket" >/dev/null 2>&1
}

daemon_supervisor_wait_for_health() {
  attempts=0
  while [ ! -S "$daemon_supervisor_socket" ]; do
    if [ "${daemon_supervisor_shutdown_requested:-0}" -eq 1 ]; then
      return 1
    fi

    if [ "$attempts" -ge "$daemon_supervisor_start_attempts" ]; then
      return 1
    fi

    attempts=$((attempts + 1))
    sleep "$daemon_supervisor_start_interval"
  done

  attempts=0
  while [ "$attempts" -lt "$daemon_supervisor_health_attempts" ]; do
    if [ "${daemon_supervisor_shutdown_requested:-0}" -eq 1 ]; then
      return 1
    fi

    if daemon_supervisor_is_live; then
      return 0
    fi

    attempts=$((attempts + 1))
    sleep "$daemon_supervisor_start_interval"
  done

  return 1
}

daemon_supervisor_send() {
  response="$(printf '%s\n' "$1" | timeout "$daemon_supervisor_health_timeout" nc -w 1 -U "$daemon_supervisor_socket" 2>/dev/null || true)"
  if [ "$response" = "ok" ]; then
    return 0
  fi

  daemon_supervisor_log "daemon command failed"
  return 1
}

daemon_supervisor_ensure() {
  launcher="$1"
  shift

  if daemon_supervisor_is_live; then
    return 0
  fi

  mkdir -p "$(dirname "$daemon_supervisor_socket")"
  if daemon_supervisor_socket_accepts_connections; then
    daemon_supervisor_log "incompatible daemon socket"
    return 1
  fi

  "$launcher" "$@" >/dev/null 2>&1 &
  daemon_supervisor_wait_for_health
}

daemon_supervisor_graceful_shutdown() {
  [ -S "$daemon_supervisor_socket" ] || return 0
  for command in $daemon_supervisor_shutdown_commands; do
    printf '%s\n' "$command" | nc -w 1 -U "$daemon_supervisor_socket" >/dev/null 2>&1 || true
  done
}

daemon_supervisor_wait_for_shutdown() {
  attempts=0
  while kill -0 "$daemon_supervisor_child_pid" >/dev/null 2>&1; do
    if [ "$attempts" -ge "$daemon_supervisor_shutdown_attempts" ]; then
      kill -TERM "$daemon_supervisor_child_pid" >/dev/null 2>&1 || true
      break
    fi

    attempts=$((attempts + 1))
    sleep "$daemon_supervisor_shutdown_interval"
  done

  wait "$daemon_supervisor_child_pid" >/dev/null 2>&1 || true
  daemon_supervisor_child_pid=""
}

# shellcheck disable=SC2329
daemon_supervisor_cleanup() {
  if [ -n "$daemon_supervisor_child_pid" ]; then
    daemon_supervisor_graceful_shutdown
    daemon_supervisor_wait_for_shutdown
  fi

  rm -f "$daemon_supervisor_socket"
  for cleanup_path in $daemon_supervisor_cleanup_paths; do
    rm -f "$cleanup_path"
  done
}

# shellcheck disable=SC2329
daemon_supervisor_request_shutdown() {
  daemon_supervisor_shutdown_requested=1
  if [ -n "$daemon_supervisor_child_pid" ]; then
    daemon_supervisor_graceful_shutdown
  fi
}

daemon_supervise() {
  if [ -z "${XDG_RUNTIME_DIR:-}" ]; then
    daemon_supervisor_log "XDG_RUNTIME_DIR is required"
    return 1
  fi

  if ! command -v flock >/dev/null 2>&1; then
    daemon_supervisor_log "flock is required"
    return 1
  fi

  if ! command -v timeout >/dev/null 2>&1; then
    daemon_supervisor_log "timeout is required"
    return 1
  fi

  mkdir -p "$(dirname "$daemon_supervisor_socket")"
  exec 9>"$daemon_supervisor_lock_file"
  if ! flock -n 9; then
    if daemon_supervisor_wait_for_health; then
      return 0
    fi

    daemon_supervisor_log "daemon lock is held without a healthy socket"
    return 1
  fi

  if daemon_supervisor_is_live; then
    daemon_supervisor_log "unmanaged daemon socket is already live"
    return 1
  fi

  if daemon_supervisor_socket_accepts_connections; then
    daemon_supervisor_log "incompatible daemon socket"
    return 1
  fi

  # The exclusive lock proves an unresponsive socket has no current owner.
  rm -f "$daemon_supervisor_socket"

  daemon_supervisor_child_pid=""
  daemon_supervisor_shutdown_requested=0
  trap daemon_supervisor_cleanup EXIT
  trap daemon_supervisor_request_shutdown INT TERM

  "$@" 9>&- &
  daemon_supervisor_child_pid="$!"

  if ! daemon_supervisor_wait_for_health; then
    if [ "$daemon_supervisor_shutdown_requested" -eq 1 ]; then
      return 0
    fi

    daemon_supervisor_log "daemon did not become healthy"
    return 1
  fi

  status=0
  while [ -n "$daemon_supervisor_child_pid" ]; do
    if [ "$daemon_supervisor_shutdown_requested" -eq 1 ]; then
      daemon_supervisor_graceful_shutdown
      daemon_supervisor_wait_for_shutdown
      return 0
    fi

    if wait "$daemon_supervisor_child_pid"; then
      daemon_supervisor_child_pid=""
      break
    else
      status=$?
      if [ "$daemon_supervisor_shutdown_requested" -eq 1 ]; then
        daemon_supervisor_graceful_shutdown
        daemon_supervisor_wait_for_shutdown
        return 0
      fi

      daemon_supervisor_child_pid=""
    fi
  done

  return "$status"
}
