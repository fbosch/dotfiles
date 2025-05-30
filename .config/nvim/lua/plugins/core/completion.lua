return {
	{
		"hrsh7th/nvim-cmp",
		dependencies = {
			"neovim/nvim-lspconfig",
			"nvim-treesitter/nvim-treesitter",
			{
				"L3MON4D3/LuaSnip",
				event = "InsertEnter",
			},
			"nvim-lua/plenary.nvim",
			{
				"f3fora/cmp-spell",
				event = "InsertEnter",
			},
			{
				"hrsh7th/cmp-nvim-lua",
				ft = { "lua" },
				event = "InsertEnter",
			},
			{
				"mtoohey31/cmp-fish",
				ft = { "fish" },
				event = "InsertEnter",
			},
			"saadparwaiz1/cmp_luasnip",
			{
				"hrsh7th/cmp-nvim-lsp",
				event = { "LspAttach", "InsertEnter" },
			},
			{
				"onsails/lspkind.nvim",
				event = { "LspAttach", "InsertEnter" },
			},
			{
				"hrsh7th/cmp-path",
				event = "InsertEnter",
			},
			{
				"hrsh7th/cmp-buffer",
				event = "InsertEnter",
			},
			{
				"hrsh7th/cmp-omni",
				event = "InsertEnter",
			},
		},
		event = { "InsertEnter" },
		config = function()
			local cmp = require("cmp")
			local types = require("cmp.types")
			local cmp_autopairs = require("nvim-autopairs.completion.cmp")
			cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done())
			local lspkind = require("lspkind")
			-- require("luasnip.loaders.from_snipmate").lazy_load({ paths = "~/.config/nvim/snippets" })
			cmp.setup({
				enabled = function()
					-- disable completion in comments
					local context = require("cmp.config.context")
					-- keep command mode completion enabled when cursor is in a comment
					if vim.api.nvim_get_mode().mode == "c" then
						return true
					else
						return not context.in_treesitter_capture("comment") and not context.in_syntax_group("Comment")
					end
				end,
				completion = {
					completeopt = "menu,menuone,noinsert",
				},
				window = {
					completion = cmp.config.window.bordered(),
					documentation = cmp.config.window.bordered(),
				},
				snippet = {
					expand = function(args)
						require("luasnip").lsp_expand(args.body)
					end,
				},
				formatting = {
					expandable_indicator = false,
					fields = { "abbr", "kind" },
					format = lspkind.cmp_format({
						mode = "symbol_text",
						ellipsis_char = "",
					}),
				},
				sources = cmp.config.sources({
					{ name = "nvim_lsp", max_item_count = 10 },
					{ name = "buffer", max_item_count = 3 },
					{ name = "path", max_item_count = 10 },
					{ name = "nvim_lua", max_item_count = 5 },
					{
						name = "omni",
						max_item_count = 5,
						option = {
							disable_omnifuncs = { "v:lua.vim.lsp.omnifunc" },
						},
					},
				}),
				mapping = cmp.mapping.preset.insert({
					["<C-f>"] = cmp.mapping.scroll_docs(4),
					["<C-d>"] = cmp.mapping.scroll_docs(-4),
					["<C-e>"] = cmp.mapping.abort(),
					["<C-y>"] = cmp.mapping.confirm({ behavior = types.cmp.ConfirmBehavior.Insert, select = true }),
					["<C-j>"] = cmp.mapping.select_next_item({ behavior = types.cmp.SelectBehavior.Select }),
					["<C-k>"] = cmp.mapping.select_prev_item({ behavior = types.cmp.SelectBehavior.Select }),
				}),
			})

			-- highlights
			local colors = require("config.colors")

			require("utils").load_highlights({
				CmpItemAbbrDeprecated = { fg = colors.lighter_gray, strikethrough = true },
				CmpItemAbbrMatch = { fg = colors.lighter_gray },
				CmpItemAbbrMatchFuzzy = { fg = colors.lighter_gray },
				CmpItemKindVariable = { fg = colors.blue },
				CmpItemKindInterface = { fg = colors.blue },
				CmpItemKindText = { fg = colors.blue },
				CmpItemKindFunction = { fg = colors.purple },
				CmpItemKindMethod = { fg = colors.purple },
				CmpItemKindKeyword = { fg = colors.lighter_gray },
				CmpItemKindProperty = { fg = colors.white },
				CmpItemKindUnit = { fg = colors.white },
				CmpItemKindSnippet = { fg = colors.orange },
			})
		end,
	},
}
