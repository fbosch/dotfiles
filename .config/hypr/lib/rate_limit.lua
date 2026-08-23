local M = {}

local socket

local function wall_clock()
	socket = socket or require("socket")
	return socket.gettime()
end

function M.new(log, interval_seconds, now)
	now = now or wall_clock
	local last_at = {}

	local function emit(key, message)
		local timestamp = now()
		local last = last_at[key]
		if last and timestamp - last < interval_seconds then
			return
		end

		last_at[key] = timestamp
		log(message)
	end

	local function reset(key)
		last_at[key] = nil
	end

	return emit, reset
end

return M
