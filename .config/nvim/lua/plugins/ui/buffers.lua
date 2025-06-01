local utils = require("utils")

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

-- generate keymaps 1-9 for buffer navigation
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
		event = "VeryLazy",
		keys = vim.list_extend({
			{
				mode = { "n" },
				"<leader>x",
				":only <bar> :BufferCloseAllButVisible<cr>",
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
		}, buffer_index_keys()),
		config = function()
			require("barbar").setup({
				animation = false,
				auto_hide = false,
				maximum_padding = 6,
				highlight_inactive_file_icons = true,
				icons = {
					pinned = {
						button = "",
					},
					separator = { left = "▎", right = "" },
					separator_at_end = false,
					diagnostics = {
						[vim.diagnostic.severity.ERROR] = { enabled = true, icon = " ", custom_color = true },
						[vim.diagnostic.severity.WARN] = { enabled = true, icon = " ", custom_color = true },
						[vim.diagnostic.severity.INFO] = { enabled = true, icon = "󰋼 ", custom_color = true },
						[vim.diagnostic.severity.HINT] = { enabled = true, icon = " ", custom_color = true },
						gitsigns = {
							added = { enabled = true, icon = "" },
							changed = { enabled = true, icon = "~" },
							deleted = { enabled = true, icon = "" },
						},
					},
				},
			})
			setup_barbar_highlights()
		end,
	},
}
