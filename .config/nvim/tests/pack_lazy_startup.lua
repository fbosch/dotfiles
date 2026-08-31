local function verify_empty_startup()
	local loader = require("config.pack.loader")
	assert(loader.is_loaded("nvim-treesitter") == false, "Tree-sitter loaded before a file buffer")
	assert(loader.is_loaded("leap.nvim") == false, "Leap loaded before its first key")
	assert(loader.is_loaded("vim-unimpaired"), "vim-unimpaired was not ready after PackReady")
	assert(loader.is_loaded("mini.sessions"), "session lifecycle was not ready before VimEnter")
	assert(loader.is_loaded("transparent.nvim"), "transparency was not ready before the first screen")
	assert(vim.g.colors_name == "zenwritten", "startup colorscheme was not applied")

	local triggers = {}
	local mappings = {
		s = { modes = { "n", "x", "o" }, plug = "<Plug>(leap-forward)" },
		S = { modes = { "n", "o" }, plug = "<Plug>(leap-backward)" },
		gs = { modes = { "n", "x", "o" }, plug = "<Plug>(leap-from-window)" },
	}
	for lhs, mapping in pairs(mappings) do
		for _, mode in ipairs(mapping.modes) do
			local keymap = vim.fn.maparg(lhs, mode, false, true)
			assert(type(keymap.callback) == "function", "Leap key trigger was not registered: " .. mode .. " " .. lhs)
			assert(keymap.expr == 1, "Leap key trigger does not preserve input state: " .. mode .. " " .. lhs)
		end
		triggers[lhs] = { callback = vim.fn.maparg(lhs, "n", false, true).callback, plug = mapping.plug }
	end
	for lhs, trigger in pairs(triggers) do
		local key_ok, replayed = pcall(trigger.callback)
		assert(key_ok, replayed)
		assert(replayed == trigger.plug, "first Leap key returned the wrong mapping: " .. lhs)
	end
	assert(loader.is_loaded("leap.nvim"), "first Leap key did not activate the plugin")
	assert(vim.fn.maparg("s", "n") == "<Plug>(leap-forward)", "Leap did not install its permanent mapping")
	assert(vim.fn.maparg("S", "x") == "<Plug>(nvim-surround-visual)", "Leap replaced visual surround")
end

local function verify_first_file()
	local loader = require("config.pack.loader")
	local buffer = vim.api.nvim_get_current_buf()
	assert(loader.is_loaded("nvim-treesitter"), "first file did not activate Tree-sitter")
	assert(vim.bo[buffer].filetype == "lua", "first file did not receive its Lua filetype")
	assert(vim.treesitter.highlighter.active[buffer] ~= nil, "first file did not start Tree-sitter highlighting")
end

local function exit_after(verify)
	vim.schedule(function()
		local ok, error_message = xpcall(verify, debug.traceback)
		if ok == false then
			vim.api.nvim_err_writeln(error_message)
			vim.cmd("cquit 1")
			return
		end
		vim.cmd("qa!")
	end)
end

if vim.env.PACK_LAZY_INITIAL_FILE == "1" then
	vim.api.nvim_create_autocmd("VimEnter", {
		once = true,
		callback = function()
			exit_after(verify_first_file)
		end,
	})
	return
end

vim.api.nvim_create_autocmd("User", {
	pattern = "PackReady",
	once = true,
	callback = function()
		exit_after(verify_empty_startup)
	end,
})
