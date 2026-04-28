local M = {}

local profiles = {
  performance = require("profiles.performance"),
  gaming = require("profiles.gaming"),
}

local function state_dir()
  return os.getenv("XDG_RUNTIME_DIR") or "/tmp"
end

local function mode_file()
  return state_dir() .. "/hypr-profiles/performance-overlay.mode"
end

local function read_file(path)
  local handle = io.open(path, "r")
  if not handle then
    return ""
  end

  local value = handle:read("*l") or ""
  handle:close()
  return value
end

function M.apply(mode)
  local profile = profiles[mode]
  if not profile then
    return false
  end

  hl.config(profile)
  return true
end

function M.apply_current()
  return M.apply(read_file(mode_file()))
end

return M
