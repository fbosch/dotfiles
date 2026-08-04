local M = {}

local function is_editable_window(window)
	if vim.api.nvim_win_is_valid(window) == false then
		return false
	end

	local buffer = vim.api.nvim_win_get_buf(window)
	local options = vim.bo[buffer]
	return vim.api.nvim_buf_is_loaded(buffer)
		and options.buftype == ""
		and options.filetype ~= "opencode"
		and options.filetype ~= "opencode_terminal"
end

local function is_source_window(window)
	return is_editable_window(window) and vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(window)) ~= ""
end

function M.open_file(path, line)
	if type(path) ~= "string" or path == "" or vim.fn.filereadable(path) == 0 then
		return false
	end

	local buffer = vim.fn.bufadd(path)
	vim.fn.bufload(buffer)

	local window
	local ok, recent = pcall(vim.api.nvim_get_var, "opencode_last_source_context")
	if ok and type(recent) == "table" and type(recent.buffer) == "number" then
		for _, candidate in ipairs(vim.api.nvim_list_wins()) do
			if vim.api.nvim_win_get_buf(candidate) == recent.buffer and is_source_window(candidate) then
				window = candidate
				break
			end
		end
	end

	if window == nil then
		for _, candidate in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
			if is_source_window(candidate) then
				window = candidate
				break
			end
		end
	end

	if window == nil then
		for _, candidate in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
			if is_editable_window(candidate) then
				window = candidate
				break
			end
		end
	end

	if window == nil then
		return false
	end

	vim.api.nvim_win_set_buf(window, buffer)
	local target_line = math.max(1, math.min(tonumber(line) or 1, vim.api.nvim_buf_line_count(buffer)))
	vim.api.nvim_win_set_cursor(window, { target_line, 0 })
	vim.api.nvim_set_current_win(window)
	vim.api.nvim_win_call(window, function()
		vim.cmd("normal! zz")
	end)
	return true
end

return M
