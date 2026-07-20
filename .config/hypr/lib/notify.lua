local command = require("lib.command")

local M = {}
local state_dir = (os.getenv("XDG_RUNTIME_DIR") or "/tmp") .. "/hypr-profiles"
local cooldown_seconds = 60

local function can_notify(key)
	command.ok("mkdir -p " .. command.arg(state_dir))

	local path = state_dir .. "/" .. key .. ".notification"
	local now = os.time()
	local handle = io.open(path, "r")
	local last = 0
	if handle then
		last = tonumber(handle:read("*l")) or 0
		handle:close()
	end
	if now - last < cooldown_seconds then
		return false
	end

	handle = io.open(path, "w")
	if handle then
		handle:write(tostring(now))
		handle:close()
	end
	return true
end

function M.error(key, summary, body)
	if can_notify(key) then
		command.ok(command.line("notify-send", "-a", "Hyprland", "-u", "critical", summary, body) .. " >/dev/null 2>&1")
	end
end

return M
