local M = {}

function M.cache_home()
  return os.getenv("XDG_CACHE_HOME") or (os.getenv("HOME") .. "/.cache")
end

function M.shell_quote(value)
  return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

function M.hostname()
  if os.getenv("HOSTNAME") and os.getenv("HOSTNAME") ~= "" then
    return os.getenv("HOSTNAME")
  end

  local file = io.open("/etc/hostname", "r")
  if not file then
    return ""
  end

  local hostname = file:read("*l") or ""
  file:close()
  return hostname
end

return M
