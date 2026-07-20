local M = {}

local function callback(action)
	if type(action) == "string" then
		return function()
			return hl.dispatch(hl.dsp.exec_cmd(action))
		end
	end

	return action
end

function M.pass()
	return { pass_event = true }
end

function M.consume()
	return {}
end

function M.when(predicate, on_true, on_false)
	on_true = callback(on_true)
	on_false = callback(on_false or M.consume)

	return function(...)
		if predicate(...) then
			return on_true(...)
		end

		return on_false(...)
	end
end

function M.pass_when(predicate, action)
	return M.when(predicate, M.pass, action)
end

function M.register(keys, action, options)
	if type(action) == "string" then
		action = hl.dsp.exec_cmd(action)
	end

	hl.bind(keys, action, options)
end

return M
