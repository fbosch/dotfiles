local repo_root = assert(vim.env.REPO_ROOT)

local function verify_lazy_startup()
	local loader = require("config.pack.loader")
	assert(loader.is_loaded("nvim-treesitter") == false, "Tree-sitter loaded before a file buffer")
	assert(loader.is_loaded("leap.nvim") == false, "Leap loaded before its first key")
	assert(loader.is_loaded("vim-unimpaired"), "vim-unimpaired was not ready after PackReady")
	assert(loader.is_loaded("mini.sessions"), "session lifecycle was not ready before VimEnter")
	assert(loader.is_loaded("transparent.nvim"), "transparency was not ready before the first screen")
	assert(vim.g.colors_name == "zenwritten", "startup colorscheme was not applied")

	vim.cmd.edit(vim.fn.fnameescape(repo_root .. "/.config/nvim/tests/pack_loader.lua"))
	local buffer = vim.api.nvim_get_current_buf()
	assert(loader.is_loaded("nvim-treesitter"), "BufReadPre did not activate Tree-sitter")
	assert(vim.bo[buffer].filetype == "lua", "first file did not receive its filetype")
	assert(vim.treesitter.highlighter.active[buffer] ~= nil, "first file did not start Tree-sitter highlighting")

	local keymap = vim.fn.maparg("s", "n", false, true)
	assert(type(keymap.callback) == "function", "Leap key trigger was not registered")
	local original_feedkeys = vim.api.nvim_feedkeys
	local replayed
	vim.api.nvim_feedkeys = function(keys, mode, escape_ks)
		replayed = { keys = keys, mode = mode, escape_ks = escape_ks }
	end
	local key_ok, key_error = pcall(keymap.callback)
	vim.api.nvim_feedkeys = original_feedkeys
	assert(key_ok, key_error)
	assert(loader.is_loaded("leap.nvim"), "first Leap key did not activate the plugin")
	assert(replayed ~= nil, "first Leap key was not replayed")
	assert(replayed.keys == vim.keycode("<Plug>(leap-forward)"), "first Leap key replayed the wrong mapping")
	assert(replayed.mode == "m" and replayed.escape_ks == false, "first Leap key used unsafe replay flags")
	assert(vim.fn.maparg("s", "n") == "<Plug>(leap-forward)", "Leap did not install its permanent mapping")
end

vim.api.nvim_create_autocmd("User", {
	pattern = "PackReady",
	once = true,
	callback = function()
		vim.schedule(function()
			local ok, error_message = xpcall(verify_lazy_startup, debug.traceback)
			if ok == false then
				vim.api.nvim_err_writeln(error_message)
				vim.cmd("cquit 1")
				return
			end
			vim.cmd("qa!")
		end)
	end,
})
