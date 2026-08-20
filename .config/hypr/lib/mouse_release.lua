local M = {}

local function mouse_button(keys)
	local button = keys:match("mouse:(%d+)")
	assert(button, "mouse release binding requires a mouse button")
	return tonumber(button)
end

function M.new(bind)
	local interactions = {}

	local function finish(button, await_mouse_release)
		local interaction = interactions[button]
		if not interaction or not interaction.release then
			return false
		end

		local release = interaction.release
		if await_mouse_release then
			interaction.release = nil
		else
			interactions[button] = nil
		end
		release()
		return true
	end

	local controller = {}

	function controller.bind(keys, start)
		local button = mouse_button(keys)

		bind.register(keys, function()
			local interaction = interactions[button]
			if interaction and not interaction.release then
				interactions[button] = nil
				return bind.consume()
			end

			if finish(button) then
				return bind.consume()
			end

			local release = start()
			if type(release) == "function" then
				interactions[button] = { release = release }
				return { request_release = true }
			end
			return bind.consume()
		end, { mouse = true })
	end

	function controller.finish_all()
		local finished = false
		for button in pairs(interactions) do
			finished = finish(button, true) or finished
		end
		return finished
	end

	return controller
end

return M
