#!/usr/bin/env dash

__ags_ipc_busctl_ready=""

ags_busctl_available() {
  if [ -n "$__ags_ipc_busctl_ready" ]; then
    [ "$__ags_ipc_busctl_ready" = "1" ]
    return
  fi

  if command -v busctl >/dev/null 2>&1; then
    __ags_ipc_busctl_ready="1"
  else
    __ags_ipc_busctl_ready="0"
  fi

  [ "$__ags_ipc_busctl_ready" = "1" ]
}

ags_parse_busctl_string() {
  response=$1

  case "$response" in
    s\ \"*\")
      response=${response#s \"}
      response=${response%\"}
      printf '%s\n' "$response"
      return 0
      ;;
    s\ *)
      printf '%s\n' "${response#s }"
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ags_request() {
  component=$1
  payload=${2:-}
  instance=${AGS_INSTANCE:-ags-bundled}

  if ags_busctl_available; then
    response=$(busctl --user --timeout=0.5 call "io.Astal.$instance" /io/Astal/Application io.Astal.Application Request as 2 "$component" "$payload" 2>/dev/null) \
      && ags_parse_busctl_string "$response" \
      && return 0
  fi

  ags request -i "$instance" "$component" "$payload"
}
