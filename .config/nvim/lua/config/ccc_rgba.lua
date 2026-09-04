local convert = require("ccc.utils.convert")
local parse = require("ccc.utils.parse")
local utils = require("ccc.utils")

local picker = {
	name = "RGBA hex",
}

---@param s string
---@param init? integer
---@return integer? start_col
---@return integer? end_col
---@return number[]? rgb
---@return number? alpha
function picker:parse_color(s, init)
	init = init or 1
	local start_col, end_col = s:find("rgba%(%x%x%x%x%x%x%x%x%)", init)
	if not (start_col and end_col) then
		return
	end

	local value = s:sub(start_col + 5, end_col - 1)
	local r = parse.hex(value:sub(1, 2))
	local g = parse.hex(value:sub(3, 4))
	local b = parse.hex(value:sub(5, 6))
	local alpha = parse.hex(value:sub(7, 8))
	if r and g and b and alpha then
		return start_col, end_col, { r, g, b }, alpha
	end
end

local output = {
	name = "RGBA hex",
}

---@param rgb number[]
---@param alpha? number
---@return string
function output.str(rgb, alpha)
	local r, g, b = convert.rgb_format(rgb)
	local a = utils.round((alpha or 1) * 255)
	return ("rgba(%02x%02x%02x%02x)"):format(r, g, b, a)
end

return {
	output = output,
	picker = picker,
}
