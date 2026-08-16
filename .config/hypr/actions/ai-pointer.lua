local ags = require("lib.ags")

local M = {}

local function cursor_position()
	if not hl.get_cursor_pos then
		return nil
	end

	local position = hl.get_cursor_pos()
	if type(position) ~= "table" or type(position.x) ~= "number" or type(position.y) ~= "number" then
		return nil
	end

	return { x = math.floor(position.x), y = math.floor(position.y) }
end

function M.start()
	local position = cursor_position()
	if position then
		ags.request("ai-pointer", { action = "start", x = position.x, y = position.y })
	end
end

function M.finish()
	local position = cursor_position()
	if position then
		ags.request("ai-pointer", { action = "finish", x = position.x, y = position.y })
	end
end

return M
