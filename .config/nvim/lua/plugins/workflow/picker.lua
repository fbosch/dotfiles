return {
	{
		"nvim-telescope/telescope.nvim",
		cmd = { "Telescope" },
		config = function()
			local telescope = require("telescope")
			telescope.setup({
				defaults = {
					layout_config = {
						width = 0.4,
						height = 0.4,
						scroll_speed = 1.5,
						preview_cutoff = 30,
					},
				},
			})
		end,
	},
	{
		"ibhagwan/fzf-lua",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		cmd = { "FzfLua", "FzfRg", "FzfRgVisualSelection" },
		keys = {
			{
				"<C-p>",
				"<cmd>FzfLua files<cr>",
				desc = "find files",
				mode = { "n" },
				silent = true,
			},
			{
				"<leader>lg",
				"<cmd>FzfRg<cr>",
				desc = "livegrep ripgrep search",
				mode = { "n" },
				silent = true,
			},
			{
				"<leader>lg",
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
				-- 1. add visual selection to the clipboard
				-- 2. search for the selection
				-- 3. add to quicklist
				-- 4. create command to search and replace the quickfix list with clipboard content
				fzf.grep_visual({
					rg_glob = true,
					exec_empty_query = false,
					rg_opts = combined_options,
				})
			end, {})

			vim.api.nvim_create_user_command("FzfRg", function()
				fzf.live_grep_native({
					rg_glob = true,
					exec_empty_query = false,
					resume = true,
					rg_opts = combined_options,
				})
			end, {})
		end,
	},
}
