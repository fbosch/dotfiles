local M = {}
local command = require("lib.command")
local paths = require("lib.paths")

local profiles = {
  performance = require("profiles.performance"),
  gaming = require("profiles.gaming"),
}

local profilectl = paths.script("profilectl.sh")

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

local function profilectl_command(action, mode)
  return command.line(profilectl, action, mode)
end

local function valid_mode(mode)
  return profiles[mode] ~= nil
end

function M.current_mode()
  return read_file(mode_file())
end

function M.is_active(mode)
  if not valid_mode(mode) then
    return false
  end

  return command.ok(profilectl_command("is-active", mode) .. " >/dev/null 2>&1")
end

function M.activate(mode)
  if not valid_mode(mode) or M.is_active(mode) then
    return false
  end

  return command.ok(profilectl_command("apply", mode))
end

function M.activate_async(mode)
  if not valid_mode(mode) or M.is_active(mode) then
    return false
  end

  hl.exec_cmd(profilectl_command("apply", mode))
  return true
end

function M.remove(mode)
  if not valid_mode(mode) then
    return false
  end

  return command.ok(profilectl_command("remove", mode))
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
  return M.apply(M.current_mode())
end

return M
