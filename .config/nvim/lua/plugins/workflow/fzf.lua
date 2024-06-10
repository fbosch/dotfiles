return {
	"ibhagwan/fzf-lua",
	dependencies = { "kyazdani42/nvim-web-devicons" },
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
				hl = { border = "rounded" },
				default = {
					preview = "bat_async",
				},
			},
			previewers = {
				builtin = {
					hl_cursorline = "IncSearch", -- cursor line highlight
				},
			},
			keymap = {
				builtin = {
					["C-k"] = "preview-page-up",
					["C-j"] = "preview-page-down",
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
			})
		end, {})

		vim.api.nvim_create_user_command("FzfRg", function()
			fzf.live_grep_native({
				rg_glob = true,
				exec_empty_query = false,
				rg_opts = combined_options,
			})
		end, {})
	end,
}
