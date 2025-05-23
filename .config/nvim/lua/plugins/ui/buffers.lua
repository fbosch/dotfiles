return {
	{
		"romgrk/barbar.nvim",
		dependencies = { "kyazdani42/nvim-web-devicons" },
		event = { "VeryLazy" },
		cmd = { "BufferNext", "BufferPrevious", "BufferClose", "BufferPick" },
		priority = 50,
		keys = {
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
			local colors = require("config.colors")
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
	},
	{
		"b0o/incline.nvim",
		event = "VeryLazy",
		dependencies = { "kyazdani42/nvim-web-devicons" },
		config = function()
			local colors = require("config.colors")
			vim.api.nvim_set_hl(0, "InclineNormal", { bg = "NONE" })
			vim.api.nvim_set_hl(0, "InclineNormalNC", { bg = "NONE" })

			require("incline").setup({
				highlight = {
					groups = {
						InclineNormal = {
							default = true,
							group = "InclineNormal",
						},
						InclineNormalNC = {
							default = true,
							group = "InclineNormalNC",
						},
					},
				},
				window = {
					placement = {
						horizontal = "right",
						vertical = "top",
					},
					margin = {
						horizontal = 2,
						vertical = 2,
					},
				},
				render = function(props)
					local filename = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(props.buf), ":t")
					local ft_icon, ft_color = require("nvim-web-devicons").get_icon_color(filename)
					local is_modified = vim.bo[props.buf].modified

					local function get_git_diff()
						local icons = { removed = "", changed = "", added = "" }
						icons["changed"] = icons.modified
						local signs = vim.b[props.buf].gitsigns_status_dict
						local labels = {}
						if signs == nil then
							return labels
						end
						for name, icon in pairs(icons) do
							if tonumber(signs[name]) and signs[name] > 0 then
								table.insert(labels, {
									icon .. " " .. signs[name] .. " ",
									group = "GitSigns" .. name,
								})
							end
						end
						if #labels > 0 then
							table.insert(labels, { "┊ ", guifg = colors.light_gray })
						end
						return labels
					end
					local function get_diagnostic_label()
						local icons = { error = " ", warn = " ", info = " ", hint = " " }
						local label = {}

						for severity, icon in pairs(icons) do
							local n = #vim.diagnostic.get(
								props.buf,
								{ severity = vim.diagnostic.severity[string.upper(severity)] }
							)
							if n > 0 then
								table.insert(
									label,
									{ icon .. n .. " ", group = "DiagnosticSign" .. severity, bold = true }
								)
							end
						end
						if #label > 0 then
							table.insert(label, { "┊ ", guifg = colors.light_gray })
						end
						return label
					end

					return {
						{ get_diagnostic_label() },
						{ get_git_diff() },
						{ (ft_icon or "") .. " ", guifg = ft_color, guibg = "none" },
						{ filename .. " ", gui = "bold", guifg = is_modified and colors.orange or colors.lighter_gray },
					}
				end,
			})
		end,
	},
}
