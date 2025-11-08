local M = {}

--- Check if running in a plain TTY (not a terminal emulator)
-- @return boolean true if in plain TTY
function M.is_plain_tty()
	if vim.fn.has("gui_running") == 1 then
		return false
	end

	-- Get TTY device path (same way fish detects it)
	local tty_path = ""
	
	-- Try tty command first (most reliable)
	local ok, result = pcall(function()
		local handle = io.popen("tty 2>/dev/null")
		if handle then
			local path = handle:read("*a"):gsub("%s+", "")
			handle:close()
			if path and path ~= "" and path ~= "not a tty" then
				return path
			end
		end
		return ""
	end)
	if ok and type(result) == "string" and result ~= "" then
		tty_path = result
	end

	-- Fallback to TTY env var
	if tty_path == "" then
		local tty_env = vim.fn.getenv("TTY")
		if tty_env ~= nil and tty_env ~= vim.NIL then
			tty_path = tostring(tty_env)
		end
	end

	-- Check if it's a real TTY (not pts which is a terminal emulator)
	-- Real TTYs: /dev/tty[0-9]+ or /dev/console
	-- Terminal emulators: /dev/pts/[0-9]+
	if type(tty_path) == "string" and tty_path ~= "" then
		-- pts devices are terminal emulators
		if tty_path:match("^/dev/pts/") then
			return false
		end
		-- Real TTY devices
		if tty_path:match("^/dev/tty%d+$") or tty_path == "/dev/console" then
			return true
		end
		-- /dev/tty (without number) is the controlling terminal, check if it's a real TTY
		if tty_path == "/dev/tty" then
			-- Check if the actual device is a real TTY
			local ok2, result2 = pcall(function()
				local handle = io.popen("readlink -f /dev/tty 2>/dev/null || echo ''")
				if handle then
					local real_path = handle:read("*a"):gsub("%s+", "")
					handle:close()
					return real_path
				end
				return ""
			end)
			if ok2 and type(result2) == "string" and result2 ~= "" then
				if result2:match("^/dev/tty%d+$") then
					return true
				end
			end
		end
	end

	return false
end

return M
