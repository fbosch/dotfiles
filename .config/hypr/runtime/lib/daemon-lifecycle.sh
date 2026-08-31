#!/usr/bin/env dash

# shellcheck disable=SC2154

daemon_lifecycle_sequence=0

daemon_lifecycle_publish() {
  daemon_lifecycle_publish_state="$1"
  daemon_lifecycle_publish_reason="$2"
  daemon_lifecycle_publish_status="$3"
  daemon_lifecycle_publish_child_pid="$4"
  daemon_lifecycle_publish_detail="$5"
  daemon_lifecycle_directory="${daemon_lifecycle_file%/*}"

  mkdir -p "$daemon_lifecycle_directory"
  daemon_lifecycle_sequence=$((daemon_lifecycle_sequence + 1))
  daemon_lifecycle_temporary="${daemon_lifecycle_file}.$$.$daemon_lifecycle_sequence.tmp"
  daemon_lifecycle_old_umask="$(umask)"
  umask 077
  {
    printf 'version=1\n'
    printf 'name=%s\n' "$daemon_lifecycle_name"
    printf 'state=%s\n' "$daemon_lifecycle_publish_state"
    printf 'timestamp=%s\n' "$(date +%s)"
    printf 'owner_pid=%s\n' "$$"
    printf 'child_pid=%s\n' "$daemon_lifecycle_publish_child_pid"
    printf 'reason=%s\n' "$daemon_lifecycle_publish_reason"
    printf 'detail=%s\n' "$daemon_lifecycle_publish_detail"
    printf 'status=%s\n' "$daemon_lifecycle_publish_status"
  } > "$daemon_lifecycle_temporary"
  mv -f "$daemon_lifecycle_temporary" "$daemon_lifecycle_file"
  umask "$daemon_lifecycle_old_umask"
}

daemon_lifecycle_record_running() {
  daemon_lifecycle_publish running started "" "${1:-}" ""
}

daemon_lifecycle_record_exit() {
  daemon_lifecycle_exit_reason="$1"
  daemon_lifecycle_exit_status="$2"
  daemon_lifecycle_exit_child_pid="${3:-}"
  daemon_lifecycle_exit_detail="${4:-}"

  daemon_lifecycle_publish exited "$daemon_lifecycle_exit_reason" "$daemon_lifecycle_exit_status" "$daemon_lifecycle_exit_child_pid" "$daemon_lifecycle_exit_detail"
  if [ "$daemon_lifecycle_exit_reason" = "child-exit" ] && [ "$daemon_lifecycle_exit_status" -ne 0 ]; then
    printf '%s: child %s exited with status %s\n' "$daemon_lifecycle_name" "$daemon_lifecycle_exit_child_pid" "$daemon_lifecycle_exit_status" >&2
  fi
}
