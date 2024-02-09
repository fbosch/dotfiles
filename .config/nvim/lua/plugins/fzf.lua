return {
	"ibhagwan/fzf-lua",
	dependencies = { "kyazdani42/nvim-web-devicons" },
	cmd = { "FzfLua", "FzfFd", "FzfRg" },
	keys = {
		{
			mode = { "n" },
			"<C-p>",
			"<cmd>FzfFd<cr>",
			desc = "find files",
		},
		{
			mode = { "n" },
			"<leader>lg",
			"<cmd>FzfRg<cr>",
			desc = "livegrep ripgrep search",
		},
		{
			mode = { "n" },
			"<leader>b",
			"<cmd>FzfLua buffers<cr>",
			desc = "buffers",
		},
		{
			mode = { "n" },
			"<leader>of",
			"<cmd>FzfLua oldfiles<cr>",
			desc = "oldfiles",
		},
	},
	config = function()
		local fzf = require("fzf-lua")
		fzf.setup({
			profile = "max-perf",
			winopts = {
				hl = { border = "rounded" },
				default = {
					preview = "bat_native",
				},
			},
			previewers = {
				builtin = {
					hl_cursorline = "IncSearch", -- cursor line highlight
					extensions = {
						["png"] = { "viu", "-t", "-h=33", "-x=10", "-y=3" },
						["jpg"] = { "viu", "-t", "-h=33", "-x=10", "-y=3" },
					},
				},
				bat = {
					cmd = "bat_native",
					args = "--style=numbers,changes --color=always --line-range=:70",
					theme = "Zenwritten Dark",
				},
			},
			files = {
				args = "--style=numbers,changes --color=always --line-range=:70",
			},
			oldfiles = {
				args = "--style=numbers,changes --color=always --line-range=:70",
			},
			live_grep = {
				previewer = "bat_native",
				args = "--style=numbers,changes --color=always --line-range=:70",
				keep_last = true,
			},
			keymap = {
				builtin = {
					["C-k"] = "preview-page-up",
					["C-j"] = "preview-page-down",
				},
			},
		})

		vim.api.nvim_create_user_command("FzfFd", function()
			fzf.files({
				cmd = "fd --threads=4 --color=always -tf --strip-cwd-prefix -H",
			})
		end, {})

		vim.api.nvim_create_user_command("FzfRg", function()
			local colors =
				'--color=ansi --colors="match:bg:magenta" --colors="match:fg:black" --colors="line:fg:yellow" --colors="path:fg:white" '

			local exclude_glob =
				"!{**/node_modules/*,**/.git/*,**/.yarn/*,**/dist/*,**/.pnpm-store/*,**/.backup/*,**/.sessions/*,**/.undo/*,**/.DS_Store}"

			local combined_options = "--with-filename --max-columns=200 --smart-case --vimgrep -g '"
				.. exclude_glob
				.. "' "
				.. colors

			fzf.live_grep_resume({
				rg_glob = true,
				glob_flag = "--iglob",
				exec_empty_query = false,
				rg_opts = combined_options,
			})
		end, {})
	end,
}
