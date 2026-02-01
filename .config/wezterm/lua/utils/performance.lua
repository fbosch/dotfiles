-- Performance monitoring utilities for WezTerm config
local M = {}

-- Simple timer for measuring execution time
function M.timer()
	local start = os.clock()
	return function()
		return (os.clock() - start) * 1000 -- Return milliseconds
	end
end

-- Log performance metrics (use with debug overlay)
function M.log_performance(name, fn)
	local stop_timer = M.timer()
	local result = fn()
	local elapsed = stop_timer()
	
	-- This will show up in the debug overlay log
	print(string.format("[PERF] %s took %.2fms", name, elapsed))
	
	return result
end

-- Memory estimation (rough)
function M.estimate_table_size(t, seen)
	seen = seen or {}
	if seen[t] then
		return 0
	end
	seen[t] = true
	
	local size = 0
	for k, v in pairs(t) do
		size = size + 1
		if type(v) == "table" then
			size = size + M.estimate_table_size(v, seen)
		end
	end
	return size
end

-- Log config load time
function M.log_config_load()
	local wezterm = require("wezterm")
	wezterm.log_info("Config reloaded at " .. wezterm.strftime("%H:%M:%S"))
end

return M
