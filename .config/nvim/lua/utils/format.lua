local M = {}

function M.word_wrap(text, width)
	local lines = {}
	for line in text:gmatch("[^\n]+") do
		while #line > width do
			-- Find last space within limit
			local wrap_at = line:sub(1, width):match(".*()[ %p]")
			wrap_at = wrap_at or width
			table.insert(lines, line:sub(1, wrap_at))
			line = line:sub(wrap_at + 1):gsub("^%s+", "")
		end
		table.insert(lines, line)
	end
	return lines
end

return M
