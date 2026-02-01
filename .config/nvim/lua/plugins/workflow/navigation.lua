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
		url = "https://codeberg.org/andyg/leap.nvim",
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
				-- leap.add_default_mappings(true)
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
			local colors = require("config.colors")
			
			-- Build FZF color scheme from zenwritten colors
			local fzf_colors = string.format(
				"fg:%s,bg:%s,hl:%s,fg+:%s,bg+:%s,hl+:%s,info:%s,prompt:%s,pointer:%s,marker:%s,spinner:%s,header:%s",
				colors.lighter_gray,  -- Normal text
				colors.background,    -- Background
				colors.blue,          -- Highlighted matches
				colors.white,         -- Selected line text
				colors.dark_gray,     -- Selected line background
				colors.cyan,          -- Selected line matches
				colors.yellow,        -- Info text (counts, etc)
				colors.orange,        -- Prompt
				colors.purple,        -- Pointer (current selection)
				colors.green,         -- Marker (multi-select)
				colors.purple,        -- Spinner
				colors.light_gray     -- Header
			)
			
			fzf.setup({
				-- Performance optimizations
				fzf_opts = {
					["--ansi"] = true,
					["--info"] = "inline",
					["--height"] = "100%",
					["--layout"] = "reverse",
					["--border"] = "none",
					["--cycle"] = true,
					["--color"] = fzf_colors,
				},
				winopts = {
					height = 0.8,
					width = 0.9,
					preview = {
						-- Use bat_native for better performance than bat_async
						default = "bat_native",
						flip_columns = 200,
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
				-- Enable ripgrep glob parsing by default
				grep = {
					rg_glob = true,
					glob_flag = "--iglob",
					glob_separator = "%s%-%-",
				},
			})

			local colors =
				'--color=ansi --colors="match:bg:magenta" --colors="match:fg:black" --colors="line:fg:yellow" --colors="path:fg:white" '

			local exclude_glob =
				"!{**/node_modules/*,**/.git/*,**/.yarn/*,**/dist/*,**/.pnpm-store/*,**/.backup/*,**/.sessions/*,**/.undo/*,**/.DS_Store,**/__pycache__/*,**/.cache/*,**/coverage/*,**/build/*,**/target/*,**/.next/*,**/.pytest_cache/*}"

			-- Performance optimized ripgrep options
			-- Note: --threads and --mmap are read from RIPGREP_CONFIG_PATH automatically
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
