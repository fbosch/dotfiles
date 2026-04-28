local command = require("lua.lib.command")
local system = require("lua.lib.system")

local M = {}

local default_timeout_seconds = 10
local default_interval_seconds = 0.2
local default_required_count = 2

local function monitor_count()
	local output = command.output("hyprctl monitors 2>/dev/null")
	local count = 0

	for line in output:gmatch("[^\n]+") do
		if line:match("^Monitor%s+") then
			count = count + 1
		end
	end

	return count
end

local function sleep(seconds)
	os.execute("sleep " .. system.shell_quote(seconds))
end

function M.wait(options)
	if type(hl) == "table" and hl.__stub then
		return true, 0
	end

	options = options or {}
	local timeout_seconds = options.timeout_seconds or default_timeout_seconds
	local interval_seconds = options.interval_seconds or default_interval_seconds
	local required_count = options.required_count or default_required_count
	local attempts = math.floor(timeout_seconds / interval_seconds)
	local count = 0

	print("Waiting for monitors to initialize...")

	for _ = 1, attempts do
		count = monitor_count()

		if count >= required_count then
			print("Both monitors detected!")
			return true, count
		end

		sleep(interval_seconds)
	end

	count = monitor_count()
	print("Warning: Timeout reached, proceeding with " .. tostring(count) .. " monitor(s)")
	return false, count
end

return M
