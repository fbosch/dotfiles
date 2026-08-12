local function setup_barbar_highlights()
	local colors = require("config.colors")
	local utils = require("utils")
	utils.load_highlights({
		BufferCurrent = { fg = colors.blue },
		BufferAlternate = { fg = colors.lighter_gray, bg = colors.gray },
		BufferInactive = { fg = colors.lighter_gray, bg = colors.gray },
		BufferVisible = { fg = colors.lighter_gray, bg = colors.gray },
		BufferAlternateSign = { fg = colors.light_gray, bg = colors.gray },
		BufferCurrentSign = { fg = colors.blue },
		BufferInactiveSign = { fg = colors.light_gray, bg = colors.gray },
		BufferVisibleSign = { fg = colors.light_gray, bg = colors.gray },
		BufferTabpageFill = { bg = colors.gray },
		BufferVisibleHINT = { fg = colors.purple },
		BufferCurrentHINT = { fg = colors.purple },
		BufferInactiveHINT = { fg = colors.purple, bg = colors.gray },
		BufferVisibleERROR = { fg = colors.red },
		BufferCurrentERROR = { fg = colors.red },
		BufferInactiveERROR = { fg = colors.red, bg = colors.gray },
		BufferVisibleWARN = { fg = colors.orange },
		BufferCurrentWARN = { fg = colors.orange },
		BufferInactiveWARN = { fg = colors.orange, bg = colors.gray },
		BufferVisibleINFO = { fg = colors.blue },
		BufferCurrentINFO = { fg = colors.blue },
		BufferInactiveINFO = { fg = colors.blue, bg = colors.gray },
	})
end

local function close_all_but_visible_and_terminals()
	local current_win = vim.api.nvim_get_current_win()
	for _, win in ipairs(vim.api.nvim_list_wins()) do
		if win ~= current_win then
			local buf = vim.api.nvim_win_get_buf(win)
			local buftype = vim.api.nvim_buf_get_option(buf, "buftype")
			if buftype ~= "terminal" then
				vim.api.nvim_win_close(win, false)
			end
		end
	end
	vim.cmd("BufferCloseAllButVisible")
end

local function buffer_index_keys()
	local t = {}
	for i = 1, 9 do
		t[#t + 1] = {
			mode = { "n" },
			"<A-" .. i .. ">",
			"<cmd>BufferGoto " .. i .. "<cr>",
			desc = "go to buffer " .. i,
			silent = true,
		}
	end
	return t
end

return {
	{
		"fbosch/barbar.nvim",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		lazy = true,
		init = function()
			vim.g.barbar_auto_setup = false

			local group = vim.api.nvim_create_augroup("LoadBarbarOnSecondBuffer", { clear = true })
			vim.api.nvim_create_autocmd({ "BufAdd", "BufEnter" }, {
				group = group,
				callback = function()
					local buffers = 0
					for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
						if
							vim.bo[buffer].buflisted
							and vim.bo[buffer].buftype == ""
							and vim.api.nvim_buf_get_name(buffer) ~= ""
						then
							buffers = buffers + 1
						end
					end

					if buffers < 2 then
						return
					end

					vim.api.nvim_del_augroup_by_id(group)
					require("lazy").load({ plugins = { "barbar.nvim" } })
				end,
			})
		end,
		keys = vim.list_extend(buffer_index_keys(), {
			{
				mode = { "n" },
				"<leader>x",
				close_all_but_visible_and_terminals,
				desc = "close all but currentl active buffer or pinned buffers",
				silent = true,
			},
			{
				mode = { "n" },
				"<leader>P",
				"<cmd>BufferPin<cr>",
				desc = "pin current buffer",
				silent = true,
			},
			{
				mode = { "n" },
				"<C-h>",
				"<cmd>BufferPrevious<cr>",
				desc = "previous buffer",
				silent = true,
			},
			{
				mode = { "n" },
				"<C-l>",
				"<cmd>BufferNext<cr>",
				desc = "next buffer",
				silent = true,
			},
			{
				mode = { "n" },
				"<C-A-h>",
				"<cmd>BufferMovePrevious<cr>",
				desc = "move buffer left",
				silent = true,
			},
			{
				mode = { "n" },
				"<C-A-l>",
				"<cmd>BufferMoveNext<cr>",
				desc = "move buffer right",
				silent = true,
			},
		}),
		config = function()
			local terminal = require("utils.terminal")
			local is_rich = terminal.is_terminal_emulator()
			local vim_enter_autocmds = {}
			for _, autocmd in ipairs(vim.api.nvim_get_autocmds({ event = "VimEnter" })) do
				if autocmd.id ~= nil then
					vim_enter_autocmds[autocmd.id] = true
				end
			end

			require("barbar").setup({
				animation = false,
				auto_hide = true,
				maximum_padding = 5,
				tabpages = true,
				highlight_inactive_file_icons = true,
				highlight_alternate = true,
				sidebar_filetypes = {
					NvimTree = true,
				},
				exclude_name = {
					"startup-log.txt",
				},
				exclude_ft = {
					"opencode",
					"opencode_terminal",
				},
				icons = {
					filetype = {
						custom_colors = false,
						enabled = is_rich,
					},
					pinned = {
						button = is_rich and "󰐃" or "[P]",
						filename = true,
					},
					separator = { left = is_rich and "▎" or "|", right = "" },
					separator_at_end = false,
					diagnostics = {
						[vim.diagnostic.severity.ERROR] = { enabled = true, icon = " ", custom_color = true },
						[vim.diagnostic.severity.WARN] = { enabled = true, icon = " ", custom_color = true },
						[vim.diagnostic.severity.INFO] = { enabled = true, icon = "󰋼 ", custom_color = true },
						[vim.diagnostic.severity.HINT] = { enabled = true, icon = " ", custom_color = true },
						gitsigns = {
							added = { enabled = true, icon = is_rich and "" or "+" },
							changed = { enabled = true, icon = "~" },
							deleted = { enabled = true, icon = is_rich and "" or "-" },
						},
					},
				},
			})
			setup_barbar_highlights()

			if vim.v.vim_did_enter == 0 then
				return
			end

			-- Barbar defers its setup to VimEnter, which has already occurred here.
			for _, autocmd in ipairs(vim.api.nvim_get_autocmds({ event = "VimEnter" })) do
				if autocmd.id ~= nil and vim_enter_autocmds[autocmd.id] == nil and autocmd.callback then
					vim.api.nvim_del_autocmd(autocmd.id)
					autocmd.callback()
					require("barbar.ui.render").update()
					return
				end
			end
		end,
	},
}
