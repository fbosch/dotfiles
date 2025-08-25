return {
	-- { "tpope/vim-unimpaired", event = "VeryLazy" },
	{
		"jinh0/eyeliner.nvim",
		event = "VeryLazy",
		config = function()
			local colors = require("config.colors")
			require("eyeliner").setup({
				highlight_on_key = true,
				dim = true,
			})
			require("utils").load_highlights({
				EyelinerPrimary = { fg = colors.blue, bold = true, underline = true },
				EyelinerSecondary = { fg = colors.purple, underline = true },
				EyelinerDimmed = { fg = colors.search_backdrop },
			})
		end,
	},
	{
		"nacro90/numb.nvim",
		event = "CmdLineEnter",
		opts = {},
	},
	{
		"ggandor/leap.nvim",
		event = "VeryLazy",
		keys = {
			{ "s", mode = { "n", "x", "o" }, desc = "Leap forward to" },
			{ "S", mode = { "n", "x", "o" }, desc = "Leap backward to" },
			{ "gs", mode = { "n", "x", "o" }, desc = "Leap from windows" },
		},
		config = function(_, opts)
			vim.schedule(function()
				local leap = require("leap")
				for k, v in pairs(opts) do
					leap.opts[k] = v
				end
				leap.add_default_mappings(true)
			end)
		end,
	},
	{
		"ibhagwan/fzf-lua",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		cmd = { "FzfLua", "FzfRg", "FzfRgVisualSelection", "FzfLuaFilesExtended" },
		keys = {
			{
				"<C-p>",
				"<cmd>FzfLua files<cr>",
				desc = "find files",
				mode = { "n" },
				silent = true,
			},
			{
				"<leader>l",
				"<cmd>FzfRg<cr>",
				desc = "livegrep ripgrep search",
				mode = { "n" },
				silent = true,
			},
			{
				"<leader>l",
				"<cmd>FzfRgVisualSelection<cr>",
				desc = "ripgrep search visual selection",
				mode = { "v" },
				silent = true,
			},
			{
				"<leader>b",
				"<cmd>FzfLua buffers<cr>",
				desc = "buffers",
				mode = { "n" },
				silent = true,
			},
			{
				"<leader>of",
				"<cmd>FzfLua oldfiles<cr>",
				desc = "oldfiles",
				mode = { "n" },
				silent = true,
			},
		},
		config = function()
			local fzf = require("fzf-lua")
			fzf.setup({
				winopts = {
					height = 0.8,
					width = 0.9,
					preview = {
						default = { "bat_async", flip_columns = 200 },
					},
				},
				hls = {
					border = "FloatBorder",
				},
				keymap = {
					builtin = {
						["C-k"] = "preview-page-up",
						["C-j"] = "preview-page-down",
					},
					fzf = {
						["ctrl-u"] = "half-page-up",
						["ctrl-d"] = "half-page-down",
						["ctrl-q"] = "select-all+accept",
					},
				},
			})

			local colors =
				'--color=ansi --colors="match:bg:magenta" --colors="match:fg:black" --colors="line:fg:yellow" --colors="path:fg:white" '

			local exclude_glob =
				"!{**/node_modules/*,**/.git/*,**/.yarn/*,**/dist/*,**/.pnpm-store/*,**/.backup/*,**/.sessions/*,**/.undo/*,**/.DS_Store}"

			local combined_options = "--with-filename --max-columns=200 --smart-case --vimgrep -g '"
				.. exclude_glob
				.. "' "
				.. colors

			vim.api.nvim_create_user_command("FzfRgVisualSelection", function()
				fzf.grep_visual({
					rg_glob = true,
					exec_empty_query = false,
					rg_opts = combined_options,
					silent = true,
				})
			end, {})

			vim.api.nvim_create_user_command("FzfLuaFilesExtended", function()
				local bufnr = vim.api.nvim_get_current_buf()
				local root = vim.fs.root(bufnr, { "package.json", ".git" })
				local rel_path = vim.fn.fnamemodify(root, ":~:.")
				fzf.files({
					resume = true,
					exec_empty_query = false,
					__call_opts = {
						query = rel_path .. "/",
					},
				})
			end, {})

			vim.api.nvim_create_user_command("FzfRg", function()
				fzf.live_grep_native({
					rg_glob = true,
					exec_empty_query = false,
					resume = true,
					rg_opts = combined_options,
					silent = true,
				})
			end, {})
		end,
	},
}
