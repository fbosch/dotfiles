return {
	"romgrk/barbar.nvim",
	dependencies = { "kyazdani42/nvim-web-devicons" },
	event = { "VeryLazy" },
	cmd = { "BufferNext", "BufferPrevious", "BufferClose", "BufferPick" },
	priority = 50,
	keys = {
		{
			mode = { "n" },
			"<leader>x",
			":only <bar> :BufferCloseAllButCurrentOrPinned<cr>",
			desc = "close all but currentl active buffer or pinned buffers",
		},
		{
			mode = { "n" },
			"<leader>P",
			"<cmd>BufferPin<cr>",
			desc = "pin current buffer",
		},
		{
			mode = { "n" },
			"<C-h>",
			"<cmd>BufferPrevious<cr>",
			desc = "previous buffer",
		},
		{
			mode = { "n" },
			"<C-l>",
			"<cmd>BufferNext<cr>",
			desc = "next buffer",
		},
		{
			mode = { "n" },
			"<C-A-h>",
			"<cmd>BufferMovePrevious<cr>",
			desc = "move buffer left",
		},
		{
			mode = { "n" },
			"<C-A-l>",
			"<cmd>BufferMoveNext<cr>",
			desc = "move buffer right",
		},
		unpack((function()
			local values = {}
			for i = 1, 9 do
				local value = {
					mode = { "n" },
					"<C-" .. i .. ">",
					"<cmd>BufferGoto " .. i .. "<cr>",
					desc = "go to buffer " .. i,
				}
				table.insert(values, value)
			end
			return values
		end)()),
	},
	config = function()
		local colors = require("colors")
		vim.api.nvim_set_hl(0, "BufferCurrent", { fg = colors.blue })
		-- diagnostics

		require("barbar").setup({
			animation = false,
			auto_hide = true,
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

		vim.api.nvim_set_hl(0, "BufferDefaultVisibleHINT", { fg = colors.purple })
		vim.api.nvim_set_hl(0, "BufferDefaultCurrentHINT", { fg = colors.purple })
		vim.api.nvim_set_hl(0, "BufferDefaultInactiveHINT", { fg = colors.purple, bg = colors.gray })
		vim.api.nvim_set_hl(0, "BufferDefaultVisibleERROR", { fg = colors.red })
		vim.api.nvim_set_hl(0, "BufferDefaultCurrentERROR", { fg = colors.red })
		vim.api.nvim_set_hl(0, "BufferDefaultInactiveERROR", { fg = colors.red, bg = colors.gray })
		vim.api.nvim_set_hl(0, "BufferDefaultVisibleWARN", { fg = colors.orange })
		vim.api.nvim_set_hl(0, "BufferDefaultCurrentWARN", { fg = colors.orange })
		vim.api.nvim_set_hl(0, "BufferDefaultInactiveWARN", { fg = colors.orange, bg = colors.gray })
		vim.api.nvim_set_hl(0, "BufferDefaultVisibleINFO", { fg = colors.blue })
		vim.api.nvim_set_hl(0, "BufferDefaultCurrentINFO", { fg = colors.blue })
		vim.api.nvim_set_hl(0, "BufferDefaultInactiveINFO", { fg = colors.blue, bg = colors.gray })
	end,
}
