local system = require("lib.system")

local M = {}
local ensured_dir = nil

local function log_path()
  return system.cache_home() .. "/hypr/lua-migration.log"
end

local function timestamp()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

function M.write(message)
  local path = log_path()
  local dir = path:match("^(.+)/[^/]+$")

  if dir and dir ~= ensured_dir then
    os.execute("mkdir -p " .. system.shell_quote(dir))
    ensured_dir = dir
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
