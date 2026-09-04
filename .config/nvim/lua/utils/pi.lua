local M = {}

local terminal_instance
local terminal_options = { win = { position = "left", width = 100 } }
local max_context_lines = 500
local max_context_bytes = 32 * 1024

local function current_terminal()
	if terminal_instance ~= nil and terminal_instance:buf_valid() then
		return terminal_instance
	end

	terminal_instance = nil
	return nil
end

local function source_context()
	local buffer = vim.api.nvim_get_current_buf()
	local options = vim.bo[buffer]
	local name = vim.api.nvim_buf_get_name(buffer)
	if
		name == ""
		or options.buftype ~= ""
		or options.filetype == "opencode"
		or options.filetype == "opencode_terminal"
	then
		return nil
	end

	local cursor = vim.api.nvim_win_get_cursor(0)
	local mode = vim.api.nvim_get_mode().mode
	local selection = vim.NIL
	if mode == "v" or mode == "V" or mode == string.char(22) then
		local anchor = vim.fn.getpos("v")
		local current = vim.fn.getpos(".")
		local lines = vim.fn.getregion(anchor, current, { type = mode })
		local bytes = math.max(0, #lines - 1)
		for _, line in ipairs(lines) do
			bytes = bytes + #line
		end
		if #lines <= max_context_lines and bytes <= max_context_bytes then
			selection = {
				mode = mode,
				anchor = { line = anchor[2], column = anchor[3] },
				cursor = { line = current[2], column = current[3] },
				lines = lines,
			}
		end
	end

	return {
		pid = vim.fn.getpid(),
		cwd = vim.fn.getcwd(),
		buffer = {
			number = buffer,
			name = name,
			loaded = vim.api.nvim_buf_is_loaded(buffer),
			filetype = options.filetype,
			buftype = options.buftype,
			modified = options.modified,
		},
		cursor = { line = math.max(cursor[1], 1), column = math.max(cursor[2] + 1, 1) },
		selection = selection,
	}
end

local function launch_command()
	local socket = vim.v.servername
	if type(socket) ~= "string" or socket == "" then
		error("pi requires a Neovim RPC socket")
	end

	return "PI_NVIM_SOCKET=" .. vim.fn.shellescape(socket) .. " pi"
end

function M.start()
	if vim.fn.executable("pi") ~= 1 then
		vim.notify("pi executable not found", vim.log.levels.ERROR)
		return nil
	end

	local terminal = current_terminal()
	if terminal ~= nil then
		terminal:show():focus()
		return terminal
	end

	vim.g.pi_launch_source_context = source_context()
	terminal = require("snacks.terminal").open(launch_command(), terminal_options)
	terminal_instance = terminal
	local function clear_terminal()
		if terminal_instance == terminal then
			terminal_instance = nil
		end
	end
	terminal:on("TermClose", clear_terminal, { buf = true })
	terminal:on("BufWipeout", clear_terminal, { buf = true })
	return terminal
end

return M
