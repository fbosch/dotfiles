local M = {}
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
	pattern = "qf",
	callback = function()
		map("n", "q", ":cclose<CR>", "Close quickfix window")
		map("n", "<ESC>", ":cclose<CR>", "Close quickfix window")
		map("n", "<leader>R", function()
			require("utils.refactor").project_find_and_replace(vim.fn.getreg("v"))
		end, "Initialize find and replace with text from cliboard")
	end,
})

cmd({ "FileType" }, {
	pattern = "Trouble",
	callback = function()
		vim.notify("Trouble!")
		map("n", "<ESC>", ":TroubleClose<CR>")
		map("n", "<leader>R", function()
			require("utils.refactor").project_find_and_replace(vim.fn.getreg("v"))
		end, "Initialize find and replace with text from cliboard")
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

function M.setup_filetype_abbreviations(pattern, abbr)
	return cmd({ "FileType" }, {
		pattern = pattern,
		callback = function()
			vim.schedule(function()
				for k, v in pairs(abbr) do
					vim.cmd(string.format("abbreviate %s %s", k, v))
				end
			end)
		end,
	})
end

function M.setup_diagnostics()
	vim.diagnostic.config({
		signs = {
			text = {
				[vim.diagnostic.severity.ERROR] = " ",
				[vim.diagnostic.severity.WARN] = " ",
				[vim.diagnostic.severity.HINT] = " ",
				[vim.diagnostic.severity.INFO] = " ",
			},
			numhl = {
				[vim.diagnostic.severity.ERROR] = "DiagnosticSignError",
				[vim.diagnostic.severity.WARN] = "DiagnosticSignWarn",
				[vim.diagnostic.severity.HINT] = "DiagnosticSignHint",
				[vim.diagnostic.severity.INFO] = "DiagnosticSignInfo",
			},
			linehl = {},
		},
		virtual_text = false,
		float = {
			show_header = true,
			source = "if_many",
			border = "rounded",
			focusable = false,
			max_width = 100,
			max_height = 10,
			close_events = {
				"BufLeave",
				"CursorMoved",
				"InsertEnter",
				"FocusLost",
			},
		},
		underline = {
			severity = { min = vim.diagnostic.severity.WARN },
		},
		severity_sort = {
			reverse = false,
		},
		update_in_insert = false,
	})

	local diagnostics_group = vim.api.nvim_create_augroup("DiagnosticsGroup", { clear = true })
	cmd({ "CursorHold", "CursorHoldI" }, {
		group = diagnostics_group,
		callback = function()
			vim.diagnostic.open_float(nil, {
				focusable = false,
				close_events = {
					"BufLeave",
					"CursorMoved",
					"InsertEnter",
					"FocusLost",
				},
				source = "if_many",
				scope = "line",
			})
		end,
	})
end

function M.setup_formatters(client, bufnr)
	local group = vim.api.nvim_create_augroup("LspFormatting", {})

	if client.name == "eslint" then
		vim.api.nvim_create_autocmd("BufWritePre", {
			buffer = bufnr,
			command = "EslintFixAll",
			group = group,
		})
	end
end

return M
