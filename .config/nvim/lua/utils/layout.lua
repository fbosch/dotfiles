local M = {}

function M.get_centered_row_col(height, width)
	height = height or 0
	width = width or 0
	local editor_height = vim.o.lines -- total lines including cmdline and tabline
	local editor_width = vim.o.columns
	-- Account for the command line at the bottom (usually 1 line)
	local cmd_height = vim.o.cmdheight or 1
	local actual_height = editor_height - cmd_height

	local row = math.floor((actual_height - height) / 2)
	local col = math.floor((editor_width - width) / 2)
	return row, col
end

return M
