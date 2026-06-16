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

			local function has_highlight_query(lang)
				local query_ok, query = pcall(vim.treesitter.query.get, lang, "highlights")
				return query_ok and query ~= nil
			end

			local required_languages = { "typescript", "tsx", "javascript", "jsdoc" }
			local missing_languages = {}
			for _, lang in ipairs(required_languages) do
				if has_parser(lang) == false or has_highlight_query(lang) == false then
					table.insert(missing_languages, lang)
				end
			end

			if #missing_languages > 0 then
				treesitter.install(missing_languages, { force = true })
			end

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
		"windwp/nvim-ts-autotag",
		event = { "BufReadPre", "BufNewFile" },
		opts = {},
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
	{
		"aaronik/treewalker.nvim",
		keys = {
			{
				"<C-k>",
				"<cmd>Treewalker Up<CR>",
				mode = { "n", "x" },
				desc = "Treewalker up",
				silent = true,
			},
			{
				"<C-j>",
				"<cmd>Treewalker Down<CR>",
				mode = { "n", "x" },
				desc = "Treewalker down",
				silent = true,
			},
			-- {
			-- 	"<C-h>",
			-- 	"<cmd>Treewalker Left<CR>",
			-- 	mode = { "n", "x" },
			-- 	desc = "Treewalker left",
			-- 	silent = true,
			-- },
			-- {
			-- 	"<C-l>",
			-- 	"<cmd>Treewalker Right<CR>",
			-- 	mode = { "n", "x" },
			-- 	desc = "Treewalker right",
			-- 	silent = true,
			-- },
			{
				"<C-A-k>",
				"<cmd>Treewalker SwapUp<CR>",
				mode = { "n" },
				desc = "Treewalker swap up",
				silent = true,
			},
			{
				"<C-A-j>",
				"<cmd>Treewalker SwapDown<CR>",
				mode = { "n" },
				desc = "Treewalker swap down",
				silent = true,
			},
			{
				"<C-A-h>",
				"<cmd>Treewalker SwapLeft<CR>",
				mode = { "n" },
				desc = "Treewalker swap left",
				silent = true,
			},
			{
				"<C-A-l>",
				"<cmd>Treewalker SwapRight<CR>",
				mode = { "n" },
				desc = "Treewalker swap right",
				silent = true,
			},
		},
		cmd = { "Treewalker" },
		opts = {},
	},
}
