local pip = require("lib.picture_in_picture")
local M = {}

function M.request(value)
	local accepted, err = pip.acceptance.normalize(value)
	assert(accepted, err)
	local fields = {}
	for _, name in ipairs({ "kind", "target_monitor", "corner", "x", "y", "width", "height" }) do
		local field = accepted[name]
		if field ~= nil then
			fields[#fields + 1] = name
				.. "="
				.. (type(field) == "number" and tostring(field) or string.format("%q", field))
		end
	end
	return "eval local ok, err = hl.plugin.persistent_position.accept_pip_placement({"
		.. table.concat(fields, ",")
		.. "}); assert(ok, err)"
end

return M
