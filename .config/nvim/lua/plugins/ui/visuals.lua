local register = require("config.pack.registry").register

register({
	{
		name = "live-command.nvim",
		src = "https://github.com/smjonas/live-command.nvim.git",
		events = { "CmdlineEnter" },
		module = "live-command",
		opts = {
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
		},
	},
	{
		name = "tint.nvim",
		src = "https://github.com/fbosch/tint.nvim.git",
		events = { "BufWinEnter" },
		setup = function()
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
						"Ccc*",
						"Leap*",
					},
				})
			end)
		end,
	},
})

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

			local platform = require("utils.platform")
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
		"petertriho/nvim-scrollbar",
		event = "VeryLazy",
		priority = 10,
		opts = {
			excluded_buftypes = { "terminal", "prompt" },
			handle = {
				color = "#222222",
			},
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
		"folke/snacks.nvim",
		event = "VeryLazy",
		priority = 1000,
		opts = {
			animate = {},
			util = {},
			input = {
				enabled = true,
			},
			picker = {
				enabled = true,
			},
		},
		init = function()
			local builtin_input = vim.ui.input
			local builtin_select = vim.ui.select

			vim.ui.input = function(opts, on_confirm)
				opts = opts or {}
				local ok, snacks = pcall(require, "snacks")
				if ok then
					return snacks.input.input(opts, on_confirm)
				end

				if builtin_input ~= nil then
					return builtin_input(opts, on_confirm)
				end

				if on_confirm ~= nil then
					on_confirm(vim.fn.input(opts.prompt or ""))
				end
			end

			vim.ui.select = function(items, opts, on_choice)
				local ok, snacks = pcall(require, "snacks")
				if ok then
					return snacks.picker.select(items, opts, on_choice)
				end

				if builtin_select ~= nil then
					return builtin_select(items, opts, on_choice)
				end

				if on_choice ~= nil then
					on_choice(nil, nil)
				end
			end
		end,
		config = function(_, opts)
			require("snacks").setup(opts)
		end,
	},
	{
		"tzachar/local-highlight.nvim",
		event = { "CursorMoved" },
		config = function()
			require("local-highlight").setup({
				hlgroup = "LocalHighlight",
			})
		end,
	},
	{
		"lukas-reineke/indent-blankline.nvim",
		event = { "BufReadPost", "BufNewFile" },
		priority = 100,
		config = function()
			local terminal = require("utils.terminal")
			local is_tty = terminal.is_plain_tty()
			local indent_char = is_tty and "|" or "▏"
			local scope_char = is_tty and "|" or "▏"

			-- Set highlights before setup to ensure colors are applied
			local colors = require("config.colors")
			vim.api.nvim_set_hl(0, "IblIndent", { fg = colors.dark_gray })
			vim.api.nvim_set_hl(0, "IblScope", { fg = colors.match_blue })

			require("ibl").setup({
				indent = { char = indent_char },
				scope = {
					char = scope_char,
					enabled = true,
				},
			})
		end,
	},
}
