return {
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		lazy = false,
		dependencies = {
			{ "andymass/vim-matchup", enabled = false },
			{ "nvim-treesitter/nvim-treesitter-context", enabled = false },
			"windwp/nvim-ts-autotag",
		},
		config = function()
			local ok, treesitter = pcall(require, "nvim-treesitter")
			if not ok then
				vim.notify("nvim-treesitter not found", vim.log.levels.ERROR)
				return
			end

			treesitter.setup({})

			local required_languages = { "typescript", "tsx", "javascript", "jsdoc" }
			local missing_languages = {}
			for _, lang in ipairs(required_languages) do
				local has_parser = pcall(vim.treesitter.language.add, lang)
				if has_parser == false then
					table.insert(missing_languages, lang)
				end
			end

			if #missing_languages > 0 then
				treesitter.install(missing_languages)
			end

			local group = vim.api.nvim_create_augroup("TreesitterStart", { clear = true })
			vim.api.nvim_create_autocmd("FileType", {
				group = group,
				callback = function(args)
					pcall(vim.treesitter.start, args.buf)
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
			{
				"<C-h>",
				"<cmd>Treewalker Left<CR>",
				mode = { "n", "x" },
				desc = "Treewalker left",
				silent = true,
			},
			{
				"<C-l>",
				"<cmd>Treewalker Right<CR>",
				mode = { "n", "x" },
				desc = "Treewalker right",
				silent = true,
			},
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
