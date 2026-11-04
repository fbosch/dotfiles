-- Editor unit tests use synthetic channel IDs. Transport tests load the real editor adapter.
local function frozen(values)
	return setmetatable({}, {
		__index = values,
		__newindex = function()
			error("test Pi Ask host is immutable", 2)
		end,
		__metatable = false,
	})
end

local function start(options)
	local stopped = false
	local methods = {}
	function methods.is_open(_)
		return not stopped
	end
	function methods.notify(channel, method, request)
		if stopped or method ~= "pi:nvim-prompt/v1" then
			return false
		end
		local hook = rawget(_G, "pi_test_ask_notify")
		if type(hook) == "function" then
			return hook(channel, method, request)
		end
		return true
	end
	function methods.close(channel)
		options.closed(channel)
		return true
	end
	function methods.stop()
		stopped = true
	end
	local root = vim.env.PI_ASK_FIXTURE_ROOT or vim.fn.tempname()
	methods.socketPath = root .. "/pi-ask-" .. tostring(vim.fn.getpid()) .. ".sock"
	return frozen(methods)
end

return frozen({ start = start })
