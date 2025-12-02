local utils = require("utils")
local terminal = require("utils.terminal")

local function setup_barbar_highlights()
	local colors = require("config.colors")
	utils.load_highlights({
		BufferCurrent = { fg = colors.blue },
		BufferDefaultVisibleHINT = { fg = colors.purple },
		BufferDefaultCurrentHINT = { fg = colors.purple },
		BufferDefaultInactiveHINT = { fg = colors.purple, bg = colors.gray },
		BufferDefaultVisibleERROR = { fg = colors.red },
		BufferDefaultCurrentERROR = { fg = colors.red },
		BufferDefaultInactiveERROR = { fg = colors.red, bg = colors.gray },
		BufferDefaultVisibleWARN = { fg = colors.orange },
		BufferDefaultCurrentWARN = { fg = colors.orange },
		BufferDefaultInactiveWARN = { fg = colors.orange, bg = colors.gray },
		BufferDefaultVisibleINFO = { fg = colors.blue },
		BufferDefaultCurrentINFO = { fg = colors.blue },
		BufferDefaultInactiveINFO = { fg = colors.blue, bg = colors.gray },
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
		"romgrk/barbar.nvim",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		event = { "BufReadPost", "BufNewFile" },
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
			local is_rich = terminal.is_terminal_emulator()
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
					separator_at_end = true,
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
		end,
	},
}
