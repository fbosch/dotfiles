local cmd = vim.api.nvim_create_autocmd
local map = require("utils").set_keymap
local group = vim.api.nvim_create_augroup("default", {})

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

cmd({ "FileType" }, {
	pattern = { "markdown", "gitcommit" },
	command = "setlocal spell spelllang=en_us",
	group = group,
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
		if vim.o.nu then
			vim.opt.relativenumber = false
			vim.cmd("redraw")
		end
	end,
})
