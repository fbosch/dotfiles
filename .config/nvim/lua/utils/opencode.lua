local M = {}

local function is_source_window(window)
	if vim.api.nvim_win_is_valid(window) == false then
		return false
	end

	local buffer = vim.api.nvim_win_get_buf(window)
	local options = vim.bo[buffer]
	return vim.api.nvim_buf_is_loaded(buffer)
		and vim.api.nvim_buf_get_name(buffer) ~= ""
		and options.buftype == ""
		and options.filetype ~= "opencode"
		and options.filetype ~= "opencode_terminal"
end

function M.open_file(path)
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
		return false
	end

	vim.api.nvim_win_set_buf(window, buffer)
	return true
end

return M
