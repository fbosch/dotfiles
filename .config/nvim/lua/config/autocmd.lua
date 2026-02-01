local cmd = vim.api.nvim_create_autocmd
local map = require("utils").set_keymap
local group = vim.api.nvim_create_augroup("default", {})

-- Sync clipboard between OS and Neovim.
-- Function to set OSC 52 clipboard
local function set_osc52_clipboard()
	local function my_paste()
		local content = vim.fn.getreg('"')
		return vim.split(content, "\n")
	end

	local osc52_copy = require("vim.ui.clipboard.osc52").copy
	local function debug_copy(register)
		return function(lines, regtype)
			vim.notify("OSC 52 copy triggered for register " .. register, vim.log.levels.INFO)
			return osc52_copy(register)(lines, regtype)
		end
	end

	vim.g.clipboard = {
		name = "OSC 52",
		copy = {
			["+"] = debug_copy("+"),
			["*"] = debug_copy("*"),
		},
		paste = {
			["+"] = my_paste,
			["*"] = my_paste,
		},
	}
end

-- Check if the current session is a remote WezTerm session based on the WezTerm executable
local function check_wezterm_remote_clipboard(callback)
	local wezterm_executable = vim.uv.os_getenv("WEZTERM_EXECUTABLE")

	if wezterm_executable and wezterm_executable:find("wezterm-mux-server", 1, true) then
		callback(true) -- Remote WezTerm session found
	else
		callback(false) -- No remote WezTerm session
	end
end

-- Schedule the setting after `UiEnter` because it can increase startup-time.
vim.schedule(function()
	vim.opt.clipboard:append("unnamedplus")
	local ssh_client = vim.uv.os_getenv("SSH_CLIENT")
	local ssh_tty = vim.uv.os_getenv("SSH_TTY")

	-- Standard SSH session handling
	if ssh_client ~= nil or ssh_tty ~= nil then
		-- vim.notify("Setting OSC 52 clipboard", vim.log.levels.INFO)
		set_osc52_clipboard()
	else
		check_wezterm_remote_clipboard(function(is_remote_wezterm)
			if is_remote_wezterm then
				-- vim.notify("Setting OSC 52 clipboard (WezTerm remote)", vim.log.levels.INFO)
				set_osc52_clipboard()
			end
		end)
	end
end)

-- set json files to json5 filetype
cmd({ "BufRead", "BufNewFile" }, {
	pattern = { ".{eslint,babel,stylelint,prettier}rc" },
	command = "setlocal ft=json5",
	group = group,
})

-- set mdx files to jsx filetype
cmd({ "BufRead", "BufNewFile" }, {
	pattern = { ".mdx" },
	command = "setlocal ft=jsx",
	group = group,
})

-- Enable spell checking for text-heavy filetypes (deferred for faster startup)
cmd({ "FileType" }, {
	pattern = { "markdown", "gitcommit", "text", "tex", "plaintex" },
	group = group,
	callback = function()
		if not vim.g.vscode then
			vim.opt_local.spell = true
			vim.opt_local.spelllang = "en_us,da"
			vim.opt_local.spelloptions:append("noplainbuffer")
		end
	end,
})

cmd({ "TextYankPost" }, {
	command = "lua vim.highlight.on_yank({ higroup = 'IncSearch', timeout = 300 })",
	group = group,
})

cmd({ "FileType" }, {
	command = "cabbrev wqa Z",
	group = group,
})

cmd({ "InsertLeave" }, {
	command = "set nopaste",
	group = group,
})

cmd({ "FileType" }, {
	pattern = "snacks_input",
	group = group,
	callback = function(args)
		local bufnr = args.buf
		cmd({ "BufLeave", "WinLeave" }, {
			buffer = bufnr,
			once = true,
			callback = function() end,
		})
	end,
})

-- help buffer
cmd({ "FileType" }, {
	pattern = "help",
	group = group,
	callback = function(args)
		vim.cmd("wincmd L") -- move help buffer to vertical right
		map("n", "<ESC>", "<C-w>c", { buffer = args.buf, silent = true })
		map("n", "gd", function()
			local word = vim.fn.expand("<cword>")
			vim.cmd("helpgrep " .. vim.fn.escape(word, " "))
			local qflist = vim.fn.getqflist()
			if #qflist == 1 then
				-- Jump directly to the match, replace current buffer
				vim.cmd("cfirst")
				-- Optionally close quickfix if it pops up (shouldn't with cfirst, but for safety)
				vim.cmd("Trouble close")
			else
				vim.cmd("Trouble qflist")
			end
		end, {
			buffer = args.buf,
			silent = true,
		})
	end,
})

-- enable relative line numbers in insert mode
cmd({ "BufEnter", "FocusGained", "InsertLeave", "CmdlineLeave", "WinEnter" }, {
	pattern = "*",
	group = group,
	callback = function()
		-- Skip nvim-tree and other special buffers
		if vim.bo.filetype == "NvimTree" or vim.bo.buftype ~= "" then
			return
		end
		if vim.o.nu and vim.api.nvim_get_mode().mode ~= "i" then
			vim.opt.relativenumber = true
		end
	end,
})

-- disable relative line numbers in normal mode
cmd({ "BufLeave", "FocusLost", "InsertEnter", "CmdlineEnter", "WinLeave" }, {
	pattern = "*",
	group = group,
	callback = function()
		-- Skip nvim-tree and other special buffers
		if vim.bo.filetype == "NvimTree" or vim.bo.buftype ~= "" then
			return
		end
		if vim.o.nu then
			vim.opt.relativenumber = false
			vim.cmd("redraw")
		end
	end,
})

-- auto-reload files when changed externally
cmd({ "FocusGained", "BufEnter", "CursorHold", "CursorHoldI" }, {
	pattern = "*",
	group = group,
	callback = function()
		if vim.fn.mode() ~= "c" then
			vim.cmd("checktime")
		end
	end,
})

cmd({ "FileChangedShellPost" }, {
	pattern = "*",
	group = group,
	callback = function()
		vim.notify("File changed on disk. Buffer reloaded.", vim.log.levels.WARN)
	end,
})

cmd({ "WinEnter", "BufEnter", "FocusGained" }, {
	group = group,
	callback = function()
		local bufnr = vim.api.nvim_get_current_buf()
		local filetype = vim.bo[bufnr].filetype
		if filetype == "toggleterm" then
			vim.defer_fn(function()
				vim.cmd("startinsert")
			end, 20)
		end
	end,
})
