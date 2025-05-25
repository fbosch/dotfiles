local M = {}

function M.merge_tables(...)
	local merged = {}
	for _, table in ipairs({ ... }) do
		for key, value in pairs(table) do
			merged[key] = value
		end
	end

	return merged
end

function M.infer_require_prefix(dir)
	local lua_root = vim.fn.stdpath("config") .. "/lua/"
	local rel = dir:sub(#lua_root + 1)
	return rel:gsub("/", ".")
end

function M.require_dir_modules(dir)
	local modules = {}
	local require_prefix = M.infer_require_prefix(dir)
	local files = vim.fn.globpath(dir, "*.lua", false, true)
	table.sort(files)
	for _, file in ipairs(files) do
		local fname = vim.fn.fnamemodify(file, ":t:r")
		if fname ~= "init" then
			local modname = require_prefix .. "." .. fname
			table.insert(modules, require(modname))
		end
	end
	return modules
end

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

function M.detect_os()
	local system_name = vim.loop.os_uname().sysname
	local is_windows = system_name == "Windows_NT"
	local is_macos = system_name == "Darwin"
	local is_linux = system_name == "Linux"
	local is_wsl = false

	if is_windows or is_linux then
		local handle = io.popen("uname -r")
		if handle then
			local kernel_version = handle:read("*a") or ""
			handle:close()
			is_wsl = kernel_version:match("Microsoft") or kernel_version:match("WSL") or false
		end
	end

	return {
		is_windows = is_windows,
		is_macos = is_macos,
		is_linux = is_linux,
		is_wsl = is_wsl and true or false,
	}
end

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
