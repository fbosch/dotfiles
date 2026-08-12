require("config.pack.registry").register({
	name = "treewalker.nvim",
	src = "https://github.com/aaronik/treewalker.nvim.git",
	module = "treewalker",
	commands = { "Treewalker" },
	keys = {
		{
			"<C-k>",
			function()
				vim.cmd("Treewalker Up")
			end,
			mode = { "n", "x" },
			desc = "Treewalker up",
			silent = true,
		},
		{
			"<C-j>",
			function()
				vim.cmd("Treewalker Down")
			end,
			mode = { "n", "x" },
			desc = "Treewalker down",
			silent = true,
		},
		{
			"<C-A-k>",
			function()
				vim.cmd("Treewalker SwapUp")
			end,
			mode = { "n" },
			desc = "Treewalker swap up",
			silent = true,
		},
		{
			"<C-A-j>",
			function()
				vim.cmd("Treewalker SwapDown")
			end,
			mode = { "n" },
			desc = "Treewalker swap down",
			silent = true,
		},
		{
			"<C-A-h>",
			function()
				vim.cmd("Treewalker SwapLeft")
			end,
			mode = { "n" },
			desc = "Treewalker swap left",
			silent = true,
		},
		{
			"<C-A-l>",
			function()
				vim.cmd("Treewalker SwapRight")
			end,
			mode = { "n" },
			desc = "Treewalker swap right",
			silent = true,
		},
	},
	opts = {},
})

require("config.pack.registry").register({
	name = "nvim-ts-autotag",
	src = "https://github.com/windwp/nvim-ts-autotag.git",
	events = { "BufReadPre", "BufNewFile" },
	opts = {},
})

return {
	{
		"nvim-treesitter/nvim-treesitter",
		branch = "main",
		build = ":TSUpdate",
		lazy = false,
		config = function()
			local ok, treesitter = pcall(require, "nvim-treesitter")
			if not ok then
				vim.notify("nvim-treesitter not found", vim.log.levels.ERROR)
				return
			end
			treesitter.setup()

			local function prefer_bundled_parser(lang)
				for _, path in ipairs(vim.api.nvim_get_runtime_file("parser/" .. lang .. ".so", true)) do
					if path:find("/lib/nvim/parser/", 1, true) ~= nil then
						vim.treesitter.language.add(lang, { path = path })
						return
					end
				end
			end

			for _, lang in ipairs({ "c", "lua", "markdown", "markdown_inline", "query", "vim", "vimdoc" }) do
				prefer_bundled_parser(lang)
			end

			local function has_parser(lang)
				if type(lang) ~= "string" or lang == "" then
					return false
				end

				return pcall(vim.treesitter.language.inspect, lang)
			end

			vim.api.nvim_create_user_command("TSInstallMissing", function()
				local function has_highlight_query(lang)
					local query_ok, query = pcall(vim.treesitter.query.get, lang, "highlights")
					return query_ok and query ~= nil
				end

				local missing_languages = {}
				for _, lang in ipairs({
					"astro",
					"bash",
					"css",
					"dockerfile",
					"fish",
					"html",
					"javascript",
					"jsdoc",
					"json",
					"lua",
					"markdown",
					"markdown_inline",
					"nix",
					"rust",
					"toml",
					"tsx",
					"typescript",
					"yaml",
				}) do
					if has_parser(lang) == false or has_highlight_query(lang) == false then
						table.insert(missing_languages, lang)
					end
				end

				if #missing_languages == 0 then
					vim.notify("All configured treesitter parsers are installed", vim.log.levels.INFO)
					return
				end

				treesitter.install(missing_languages, { force = true })
			end, { desc = "Install missing configured treesitter parsers" })

			local group = vim.api.nvim_create_augroup("TreesitterStart", { clear = true })
			vim.api.nvim_create_autocmd("FileType", {
				group = group,
				callback = function(args)
					if vim.api.nvim_get_option_value("buftype", { buf = args.buf }) ~= "" then
						pcall(vim.treesitter.stop, args.buf)
						return
					end

					local filetype = vim.api.nvim_get_option_value("filetype", { buf = args.buf })
					local lang = vim.treesitter.language.get_lang(filetype) or filetype
					if has_parser(lang) == false then
						pcall(vim.treesitter.stop, args.buf)
						return
					end

					pcall(vim.treesitter.start, args.buf, lang)
				end,
			})
		end,
	},
	{
		"Wansmer/treesj",
		keys = {
			{
				"<leader>m",
				"<cmd>TSJToggle<CR>",
				mode = { "n" },
			},
		},
		cmd = { "TSJToggle" },
		dependencies = { "nvim-treesitter/nvim-treesitter" },
		opts = {
			use_default_keymaps = false,
		},
	},
}
