local M = {}

local function read_first_line(path)
	local lines = vim.fn.readfile(path, "", 1)
	local first_line = lines[1]
	if type(first_line) ~= "string" or first_line == "" then
		return nil
	end

	return first_line
end

local function wipe_opencode_sessions(session_root)
	local opencode_files = vim.fn.glob(session_root .. "/*.opencode", false, true)
	if type(opencode_files) ~= "table" or vim.tbl_isempty(opencode_files) then
		return
	end

	local storage_root = vim.fn.expand("~/.local/share/opencode/storage/session")
	for _, opencode_file in ipairs(opencode_files) do
		local session_id = read_first_line(opencode_file)
		if session_id ~= nil then
			local matches = vim.fn.glob(storage_root .. "/**/" .. session_id .. ".json", false, true)
			for _, match in ipairs(matches) do
				vim.fn.delete(match)
			end
		end
	end
end

function M.load_highlights(group)
	for hl, color in pairs(group) do
		vim.api.nvim_set_hl(0, hl, color)
	end
end

function M.set_usrcmd(cmd, callback, opts_or_desc)
	local opts = opts or {}
	vim.api.nvim_create_user_command(
		cmd,
		callback,
		type(opts_or_desc) == "string" and { desc = opts_or_desc } or (opts_or_desc or {})
	)
end

function M.set_keymap(mode, lhs, rhs, opts_or_desc)
	local opts = vim.tbl_extend(
		"force",
		{ noremap = true, silent = true },
		type(opts_or_desc) == "string" and { desc = opts_or_desc } or (opts_or_desc or {})
	)
	if type(lhs) == "table" then
		for _, key in ipairs(lhs) do
			vim.keymap.set(mode, key, rhs, opts)
		end
	else
		vim.keymap.set(mode, lhs, rhs, opts)
	end
end

function M.wipe_all_sessions()
	local root_dir = vim.fn.expand("~/.config/nvim/.sessions")
	local ok, err = pcall(function()
		wipe_opencode_sessions(root_dir)
		vim.fn.delete(root_dir, "rf")
	end)

	if ok then
		vim.api.nvim_exec_autocmds("User", { pattern = "SessionWipePost" })
		vim.notify("Wiped all sessions", vim.log.levels.INFO, {
			title = "AutoSession",
		})
	else
		vim.notify("Failed to wipe sessions: " .. tostring(err), vim.log.levels.ERROR, {
			title = "AutoSession",
		})
	end
end

function M.get_visual_selection_lines(bufnr)
	bufnr = bufnr or vim.api.nvim_get_current_buf()
	local mode = vim.fn.mode()
	if mode ~= "v" and mode ~= "V" then
		return nil
	end
	local start = vim.fn.getpos("'<")
	local finish = vim.fn.getpos("'>")
	local lines = vim.api.nvim_buf_get_lines(bufnr, start[2] - 1, finish[2], false)
	-- If visual mode is characterwise, trim first and last lines
	if mode == "v" and #lines > 0 then
		lines[1] = lines[1]:sub(start[3])
		lines[#lines] = lines[#lines]:sub(1, finish[3])
	end
	return lines
end

return M
