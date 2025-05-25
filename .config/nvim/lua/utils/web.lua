local M = {}
local platform = require("utils.platform")

function M.extract_uris(lines)
	opts = opts or {}
	local uris, seen = {}, {}
	for _, line in ipairs(lines) do
		for url in line:gmatch("%[.-%]%((https?://[^%s%)]+)%)") do
			if not seen[url] then
				table.insert(uris, url)
				seen[url] = true
			end
		end
		for url in line:gmatch("https?://[%w-_%.%?%.:/%+=&%%#@%!]+") do
			if not seen[url] then
				table.insert(uris, url)
				seen[url] = true
			end
		end
	end
	return uris
end

local CONFIRM_THRESHOLD = 5
function M.open_uris(uris)
	if #uris == 0 then
		vim.notify("No URLs found in buffer", vim.log.levels.INFO)
		return
	end
	local ok, snacks = pcall(require, "snacks")
	if not ok then
		vim.notify("Snacks not found.", vim.log.levels.ERROR)
		return
	end

	if #uris > CONFIRM_THRESHOLD then
		snacks.input({
			prompt = string.format("Open all %d links? (y/N)", #uris),
			icon = "󰖟 ",
			default = "n",
			win = {
				style = "minimal",
				border = "single",
				height = 1,
				width = 40,
				row = math.floor((vim.o.lines - 1) / 2),
				col = math.floor((vim.o.columns - 40) / 2),
			},
		}, function(input)
			if input and input:lower() == "y" then
				for _, uri in ipairs(uris) do
					platform.system_open(uri)
				end
			else
				vim.notify("Cancelled opening links", vim.log.levels.WARN)
			end
		end)
	else
		for _, uri in ipairs(uris) do
			platform.system_open(uri)
		end
	end
end

function M.open_uris_in_buffer(bufnr)
	bufnr = bufnr or vim.api.nvim_get_current_buf()
	local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
	local uris = M.extract_uris(lines)
	M.open_uris(uris)
end

function M.open_uris_in_selection()
	vim.cmd('normal! ""y')
	local content = vim.fn.getreg('"')

	if not content or content == "" then
		vim.notify("No visual selection found", vim.log.levels.WARN)
		return
	end
	local lines = {}
	for line in content:gmatch("[^\n]+") do
		table.insert(lines, line)
	end
	local uris = M.extract_uris(lines)
	M.open_uris(uris)
end

return M
