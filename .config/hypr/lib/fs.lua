local M = {}

function M.exists(path)
	local file = io.open(path, "r")
	if not file then
		return false
	end

	file:close()
	return true
end

return M
