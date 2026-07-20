local M = {}

function M.pass()
	return { pass_event = true }
end

function M.consume()
	return {}
end

function M.when(predicate, on_true, on_false)
	on_false = on_false or M.consume

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

function M.key(keys, action, options)
	hl.bind(keys, action, options)
end

return M
