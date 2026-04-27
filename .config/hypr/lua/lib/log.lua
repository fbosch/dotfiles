local system = dofile(os.getenv("HOME") .. "/.config/hypr/lua/lib/system.lua")

local M = {}

local function log_path()
  return system.cache_home() .. "/hypr/lua-migration.log"
end

local function timestamp()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

function M.write(message)
  local path = log_path()
  local dir = path:match("^(.+)/[^/]+$")

  if dir then
    os.execute("mkdir -p " .. system.shell_quote(dir))
  end

  local file = io.open(path, "a")
  if not file then
    return false
  end

  file:write(timestamp() .. " " .. tostring(message) .. "\n")
  file:close()
  return true
end

return M
