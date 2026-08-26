#!/usr/bin/env dash

# shellcheck disable=SC2154

daemon_supervisor_restart_exit_status=75
daemon_supervisor_restart_attempts="${daemon_supervisor_restart_attempts:-100}"
daemon_supervisor_restart_interval="${daemon_supervisor_restart_interval:-0.02}"
daemon_supervisor_state_file="${daemon_supervisor_state_file:-${daemon_supervisor_lock_file}.state}"
daemon_supervisor_restart_lock_file="${daemon_supervisor_restart_lock_file:-${daemon_supervisor_lock_file}.restart}"
daemon_supervisor_restart_request_file="${daemon_supervisor_restart_request_file:-${daemon_supervisor_lock_file}.restart-request}"

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

daemon_supervisor_read_state() {
  daemon_supervisor_state=""
  if [ -r "$daemon_supervisor_state_file" ]; then
    IFS= read -r daemon_supervisor_state < "$daemon_supervisor_state_file" || true
  fi
}

daemon_supervisor_publish_state() {
  daemon_supervisor_state_temporary="${daemon_supervisor_state_file}.$$"
  printf '%s\t%s\t%s\n' "$$" "$1" "$2" > "$daemon_supervisor_state_temporary"
  mv -f "$daemon_supervisor_state_temporary" "$daemon_supervisor_state_file"
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
  rm -f "$daemon_supervisor_state_file"
  rm -f "${daemon_supervisor_state_file}.$$"
  rm -f "$daemon_supervisor_restart_request_file"
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

  generation=0
  while true; do
    if [ "$daemon_supervisor_shutdown_requested" -eq 1 ]; then
      return 0
    fi

    DAEMON_SUPERVISOR_RESTART_EXIT_STATUS="$daemon_supervisor_restart_exit_status" "$@" 9>&- &
    daemon_supervisor_child_pid="$!"
    generation=$((generation + 1))
    daemon_supervisor_publish_state "$generation" "$daemon_supervisor_child_pid"

    if ! daemon_supervisor_wait_for_health; then
      if [ "$daemon_supervisor_shutdown_requested" -eq 1 ]; then
        return 0
      fi

      daemon_supervisor_log "daemon did not become healthy"
      return 1
    fi

    status=0
    if wait "$daemon_supervisor_child_pid"; then
      status=0
    else
      status=$?
    fi

    if [ "$daemon_supervisor_shutdown_requested" -eq 1 ]; then
      daemon_supervisor_wait_for_shutdown
      return 0
    fi
    daemon_supervisor_child_pid=""
    if [ "$status" -ne "$daemon_supervisor_restart_exit_status" ]; then
      return "$status"
    fi

    daemon_supervisor_read_state
    restart_request=""
    if [ -r "$daemon_supervisor_restart_request_file" ]; then
      IFS= read -r restart_request < "$daemon_supervisor_restart_request_file" || true
    fi
    rm -f "$daemon_supervisor_restart_request_file"
    if [ -z "$restart_request" ] || [ "$restart_request" != "$daemon_supervisor_state" ]; then
      daemon_supervisor_log "worker requested an unauthorized restart"
      return "$status"
    fi
  done
}

daemon_supervisor_restart() {
  if ! command -v flock >/dev/null 2>&1; then
    daemon_supervisor_log "flock is required"
    return 1
  fi

  daemon_supervisor_read_state
  entry_generation="$daemon_supervisor_state"

  exec 8>"$daemon_supervisor_restart_lock_file"
  if ! flock -w 2 8; then
    daemon_supervisor_log "another restart did not finish"
    exec 8>&-
    return 1
  fi

  if ! daemon_supervisor_is_live; then
    daemon_supervisor_log "daemon is not healthy"
    exec 8>&-
    return 1
  fi

  lock_conflict_status=200
  if flock -E "$lock_conflict_status" -n "$daemon_supervisor_lock_file" true; then
    daemon_supervisor_log "healthy socket is not owned by a supervisor"
    exec 8>&-
    return 1
  else
    lock_status=$?
    if [ "$lock_status" -ne "$lock_conflict_status" ]; then
      daemon_supervisor_log "could not verify supervisor lock ownership"
      exec 8>&-
      return 1
    fi
  fi

  daemon_supervisor_read_state
  previous_generation="$daemon_supervisor_state"
  if [ -z "$previous_generation" ]; then
    daemon_supervisor_log "running supervisor lost its generation state"
    exec 8>&-
    return 1
  fi
  if [ -n "$entry_generation" ] && [ "$previous_generation" != "$entry_generation" ]; then
    exec 8>&-
    return 0
  fi

  restart_request_temporary="${daemon_supervisor_restart_request_file}.$$"
  printf '%s\n' "$previous_generation" > "$restart_request_temporary"
  mv -f "$restart_request_temporary" "$daemon_supervisor_restart_request_file"
  daemon_supervisor_send restart || true

  attempts=0
  while [ "$attempts" -lt "$daemon_supervisor_restart_attempts" ]; do
    daemon_supervisor_read_state
    current_generation="$daemon_supervisor_state"
    if [ -n "$current_generation" ] \
      && [ "$current_generation" != "$previous_generation" ] \
      && daemon_supervisor_is_live; then
      rm -f "$daemon_supervisor_restart_request_file" "$restart_request_temporary"
      exec 8>&-
      return 0
    fi

    attempts=$((attempts + 1))
    sleep "$daemon_supervisor_restart_interval"
  done

  daemon_supervisor_log "replacement daemon did not become healthy"
  # The supervisor owns an accepted request until the matching worker exits.
  rm -f "$restart_request_temporary"
  exec 8>&-
  return 1
}

daemon_supervisor_main() {
  action="start"
  if [ "${1:-}" != "--" ]; then
    action="${1:-}"
    shift || true
  fi

  if [ "$action" = "-h" ] || [ "$action" = "--help" ]; then
    printf 'Usage: %s [start|restart]\n' "${0##*/}"
    return 0
  fi

  if [ "${1:-}" != "--" ]; then
    daemon_supervisor_log "usage: ${0##*/} [start|restart]"
    return 2
  fi
  shift

  case "$action" in
    start) daemon_supervise "$@" ;;
    restart) daemon_supervisor_restart ;;
    *)
      daemon_supervisor_log "unknown action: $action"
      daemon_supervisor_log "usage: ${0##*/} [start|restart]"
      return 2
      ;;
  esac
}
