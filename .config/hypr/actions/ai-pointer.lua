local ags = require("lib.ags")

local M = {}
local super_chord_used = false

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
		super_chord_used = true
		ags.request("ai-pointer", { action = "start", x = position.x, y = position.y })
	end
end

function M.finish()
	local position = cursor_position()
	if position then
		ags.request("ai-pointer", { action = "finish", x = position.x, y = position.y })
	end
end

function M.has_super_chord()
	return super_chord_used
end

function M.consume_super_chord()
	local used = super_chord_used
	super_chord_used = false
	return used
end

return M
