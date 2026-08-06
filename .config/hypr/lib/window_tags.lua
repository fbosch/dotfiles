local M = {
	non_resizable = "non-resizable",
}

function M.has(tags, expected)
	for _, tag in ipairs(tags or {}) do
		if tag:gsub("%*$", "") == expected then
			return true
		end
	end

	return false
end

return M
