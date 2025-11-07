local platform = require("utils.platform")

return {
	{
		"nvim-tree/nvim-web-devicons",
		dependencies = {
			"rachartier/tiny-devicons-auto-colors.nvim",
		},
		event = "VeryLazy",
		config = function()
			local colors = require("config.colors")
			require("nvim-web-devicons").setup({
				override_by_filename = {
					["Brewfile"] = {
						icon = "󱄖",
						color = colors.yellow,
						name = "Brewfile",
					},
					["Brewfile.lock.json"] = {
						icon = "",
						color = colors.yellow,
						name = "Brewfile",
					},
					[".prettierignore"] = {
						icon = "",
						color = colors.orange,
						name = "prettierignore",
					},
					["vite.config.js"] = {
						icon = "",
						color = colors.purple,
						name = "vite",
					},
					["vite.config.ts"] = {
						icon = "",
						color = colors.purple,
						name = "vite",
					},
				},
				override_by_extension = {
					["fish"] = {
						icon = "",
						color = colors.blue,
						name = "fish",
					},
					["css"] = {
						icon = "",
						color = colors.purple,
						name = "css",
					},
				},
			})
			local colorValues = vim.list_extend({
				colors.red,
				colors.orange,
				colors.blue,
				colors.dark_blue,
				colors.purple,
				colors.yellow,
				colors.green,
				colors.cyan,
			}, colors.highlight_args)

			require("tiny-devicons-auto-colors").setup({
				colors = colorValues,
				cache = {
					enabled = not platform.is_wsl(),
					path = "/tmp/tiny-devicons-auto-colors-cache.json",
				},
			})
		end,
	},
	{
		"smjonas/live-command.nvim",
		event = "CmdLineEnter",
		config = function()
			require("live-command").setup({
				commands = {
					Norm = { cmd = "norm" },
				},
				enable_highlighting = true,
				inline_highlighting = true,
				hl_groups = {
					insertion = "DiffAdd",
					deletion = "DiffDelete",
					change = "DiffChange",
				},
			})
		end,
	},
	{
		"petertriho/nvim-scrollbar",
		event = "VeryLazy",
		priority = 10,
		opts = {
			excluded_buftypes = { "terminal", "prompt" },
		},
	},
	{
		"folke/todo-comments.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		event = { "VeryLazy" },
		opts = {
			excluded_buftypes = { "terminal", "prompt" },
		},
	},
	{
		"tzachar/local-highlight.nvim",
		event = { "CursorMoved" },
		dependencies = {
			{
				"folke/snacks.nvim",
				lazy = false,
				priority = 1000,
				opts = {
					animate = {},
					util = {},
				},
			},
		},
		config = function()
			require("local-highlight").setup({
				hlgroup = "LocalHighlight",
			})
		end,
	},
	{
		-- "levouh/tint.nvim",
		"fbosch/tint.nvim",
		event = "BufWinEnter",
		config = function()
			vim.schedule(function()
				local tint = require("tint")
				local transforms = require("tint.transforms")
				local colors = require("config.colors")

				tint.setup({
					tint_background_colors = true,
					transforms = {
						transforms.tint_with_threshold(-30, colors.background, 100),
						transforms.saturate(0.4),
					},
					highlight_ignore_patterns = {
						"NvimTree*",
						"IndentBlankline*",
						"Ibl*",
						"Whitespace",
						"NonText",
						"Hop*",
						"Ccc*",
						"Leap*",
					},
				})
			end)
		end,
	},
	{
		"lukas-reineke/indent-blankline.nvim",
		event = "BufEnter",
		priority = 100,
		config = function()
			require("ibl").setup({
				indent = { char = "▏" },
				scope = {
					char = "▏",
					enabled = true,
				},
			})
		end,
	},
	{
		"b0o/incline.nvim",
		event = "VeryLazy",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		config = function()
			local colors = require("config.colors")
			require("utils").load_highlights({
				InclineNormal = { bg = "NONE" },
				InclineNormalNC = { bg = "NONE" },
			})
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
				hide = {
					only_win = true,
				},
				window = {
					zindex = 40,
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
