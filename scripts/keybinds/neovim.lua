local modes = { "n", "i", "v", "x", "s", "o", "t", "c" }
local bindings = {}
local seen = {}
local limitations = {}

local function canonical_lhs(lhs)
	lhs = lhs:gsub("<[Ll]eader>", vim.g.mapleader or "\\")
	lhs = lhs:gsub("<[Ll]ocal[Ll]eader>", vim.g.maplocalleader or "\\")
	return vim.api.nvim_replace_termcodes(lhs, true, true, true)
end

local function add(record)
	record.context = record.context or "global"
	local id = table.concat({ record.mode, record.context, canonical_lhs(record.lhs) }, "\0")
	if seen[id] then
		return
	end
	seen[id] = true
	table.insert(bindings, record)
end

local function runtime_record(map, mode, context)
	return {
		source = "runtime",
		mode = mode,
		lhs = map.lhs,
		context = context,
		desc = map.desc,
	}
end

-- WhichKey defers setup until VimEnter, which does not occur naturally in a
-- headless process. Materialize it only inside this disposable child process.
local existing_vimenter = {}
for _, autocmd in ipairs(vim.api.nvim_get_autocmds({ event = "VimEnter" })) do
	if autocmd.id then
		existing_vimenter[autocmd.id] = true
	end
end

pcall(require("config.pack.loader").activate, "which-key.nvim", { source = "keybind-validator" })
for _, autocmd in ipairs(vim.api.nvim_get_autocmds({ event = "VimEnter" })) do
	if autocmd.id and not existing_vimenter[autocmd.id] and autocmd.callback then
		pcall(autocmd.callback, { event = "VimEnter", id = autocmd.id, match = "" })
	end
end
vim.wait(500, function()
	local ok, config = pcall(require, "which-key.config")
	return ok and config.loaded == true
end)

for _, mode in ipairs(modes) do
	for _, map in ipairs(vim.api.nvim_get_keymap(mode)) do
		if map.lhs:sub(1, 6):lower() ~= "<plug>" and (map.desc or map.lhs ~= map.rhs) then
			add(runtime_record(map, mode, "global"))
		end
	end
end

for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
	if vim.api.nvim_buf_is_valid(bufnr) and vim.api.nvim_buf_is_loaded(bufnr) then
		local filetype = vim.bo[bufnr].filetype
		local context = filetype ~= "" and "filetype:" .. filetype or "buffer:" .. bufnr
		for _, mode in ipairs(modes) do
			for _, map in ipairs(vim.api.nvim_buf_get_keymap(bufnr, mode)) do
				if map.lhs:sub(1, 6):lower() ~= "<plug>" then
					add(runtime_record(map, mode, context))
				end
			end
		end
	end
end

for name, spec in pairs(require("config.pack.registry").all()) do
	for _, key in ipairs(spec.keys or {}) do
		local key_modes = type(key.mode) == "table" and key.mode or { key.mode or "n" }
		for _, mode in ipairs(key_modes) do
			add({
				source = "native-spec",
				owner = name,
				mode = mode,
				lhs = key[1],
				context = "global",
				desc = key.desc,
			})
		end
	end
end

local wk_ok, wk_config = pcall(require, "which-key.config")
if wk_ok and wk_config.loaded then
	for _, map in ipairs(wk_config.mappings) do
		-- Groups and labels document prefixes but do not consume input.
		if map.lhs and map.rhs then
			add({
				source = "which-key",
				mode = map.mode or "n",
				lhs = map.lhs,
				context = map.buffer and "buffer:" .. map.buffer or "global",
				desc = map.desc,
			})
		end
	end
else
	table.insert(limitations, "WhichKey did not finish initialization")
end

table.sort(bindings, function(left, right)
	local a = table.concat({ left.mode, left.context, left.lhs }, "\0")
	local b = table.concat({ right.mode, right.context, right.lhs }, "\0")
	return a < b
end)

io.write(vim.json.encode({ bindings = bindings, limitations = limitations }))
