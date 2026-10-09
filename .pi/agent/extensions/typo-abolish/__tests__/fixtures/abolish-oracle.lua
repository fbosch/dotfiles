local plugin, input_path, output_path = unpack(arg)
vim.cmd.source(plugin)
vim.o.iskeyword = "@,48-57,_,192-255"
local input = vim.json.decode(table.concat(vim.fn.readfile(input_path), "\n"))

local function dictionary(text)
	vim.cmd("iabclear")
	for line in text:gmatch("[^\r\n]+") do
		line = vim.trim(line)
		if line ~= "" and line:sub(1, 1) ~= "#" then
			local lhs, rhs = line:match("^(%S+)%s+(.+)$")
			assert(lhs and rhs, "Invalid oracle rule: " .. line)
			vim.v.errmsg = ""
			vim.api.nvim_cmd({ cmd = "Abolish", args = { lhs, rhs } }, {})
			assert(vim.v.errmsg == "", vim.v.errmsg)
		end
	end
	local result = {}
	for _, abbreviation in ipairs(vim.fn.maplist(true)) do
		result[abbreviation.lhs] = abbreviation.rhs
	end
	return result
end

local output = { cases = {}, boundaries = {}, shared = dictionary(input.shared) }
for _, rules in ipairs(input.cases) do
	table.insert(output.cases, { rules = rules, expected = dictionary(rules) })
end
dictionary("teh the")
for _, prefix in ipairs(input.boundaries) do
	vim.api.nvim_buf_set_lines(0, 0, -1, false, { "" })
	vim.api.nvim_win_set_cursor(0, { 1, 0 })
	-- Escape K_SPECIAL bytes in non-BMP UTF-8 as well as the terminal keys.
	local keys = vim.api.nvim_replace_termcodes("i" .. prefix .. " <Esc>", true, false, true)
	vim.api.nvim_feedkeys(keys, "xt", false)
	output.boundaries[prefix] = table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\n")
end
vim.fn.writefile({ vim.json.encode(output) }, output_path)
