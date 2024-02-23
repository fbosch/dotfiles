return {
	"hrsh7th/nvim-cmp",
	dependencies = {
		"neovim/nvim-lspconfig",
		"nvim-treesitter/nvim-treesitter",
		"L3MON4D3/LuaSnip",
		"nvim-lua/plenary.nvim",
		"onsails/lspkind.nvim",
		"hrsh7th/nvim-cmp",
		-- "zbirenbaum/copilot-cmp",
		{
			"f3fora/cmp-spell",
			ft = { "markdown", "text" },
		},
		{
			"hrsh7th/cmp-nvim-lua",
			ft = { "lua" },
		},
		{
			"mtoohey31/cmp-fish",
			ft = { "fish" },
		},
		"saadparwaiz1/cmp_luasnip",
		"hrsh7th/cmp-emoji",
		"hrsh7th/cmp-nvim-lsp",
		"hrsh7th/cmp-path",
		"hrsh7th/cmp-buffer",
		"hrsh7th/cmp-omni",
		{
			"tzachar/cmp-tabnine",
			build = "./install.sh",
		},
	},
	event = { "InsertEnter" },
	config = function()
		local cmp = require("cmp")
		local types = require("cmp.types")
		-- require("copilot_cmp").setup()
		local lspkind = require("lspkind")
		-- require("luasnip.loaders.from_snipmate").lazy_load({ paths = "~/.config/nvim/snippets" })
		cmp.setup({
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
					mode = "symbol",
					ellipsis_char = "",
					symbol_map = {
						TabNine = "",
						Copilot = "",
					},
					before = function(entry, vim_item)
						if entry.source.name == "cmp_tabnine" then
							local detail = (entry.completion_item.data or {}).detail
							if detail and detail:find(".*%%.*") then
								vim_item.kind = vim_item.kind .. " " .. detail
							end
							if (entry.completion_item.data or {}).multiline then
								vim_item.kind = vim_item.kind .. " " .. "[ML]"
							end
						end
						return vim_item
					end,
				}),
			},
			sources = cmp.config.sources({
				{ name = "nvim_lsp", max_item_count = 5, group_index = 1 },
				-- { name = "copilot", max_item_count = 3, group_index = 2 },
				{ name = "cmp_tabnine", max_item_count = 5, group_index = 3 },
				{ name = "path", max_item_count = 5 },
				{ name = "buffer", max_item_count = 3 },
				{ name = "emoji", max_item_count = 15 },
				{ name = "spell", max_item_count = 4 },
				{ name = "nvim_lua", max_item_count = 5 },
				{ name = "npm", max_item_count = 3 },
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
				-- ["<Space>"] = cmp.mapping.confirm({ select = true }),
				["<CR>"] = cmp.mapping.confirm({ behavior = types.cmp.ConfirmBehavior.Insert, select = true }),
				["<C-j>"] = cmp.mapping.select_next_item({ behavior = types.cmp.SelectBehavior.Select }),
				["<C-k>"] = cmp.mapping.select_prev_item({ behavior = types.cmp.SelectBehavior.Select }),
			}),
		})

		-- highlights
		local colors = require("colors")
		vim.api.nvim_set_hl(0, "CmpItemAbbrDeprecated", { fg = colors.lighter_gray, strikethrough = true })
		vim.api.nvim_set_hl(0, "CmpItemAbbrMatch", { fg = colors.lighter_gray })
		vim.api.nvim_set_hl(0, "CmpItemAbbrMatchFuzzy", { fg = colors.lighter_gray })
		vim.api.nvim_set_hl(0, "CmpItemKindVariable", { fg = colors.blue })
		vim.api.nvim_set_hl(0, "CmpItemKindInterface", { fg = colors.blue })
		vim.api.nvim_set_hl(0, "CmpItemKindText", { fg = colors.blue })
		vim.api.nvim_set_hl(0, "CmpItemKindFunction", { fg = colors.purple })
		vim.api.nvim_set_hl(0, "CmpItemKindMethod", { fg = colors.purple })
		vim.api.nvim_set_hl(0, "CmpItemKindKeyword", { fg = colors.lighter_gray })
		vim.api.nvim_set_hl(0, "CmpItemKindProperty", { fg = colors.white })
		vim.api.nvim_set_hl(0, "CmpItemKindUnit", { fg = colors.white })
		vim.api.nvim_set_hl(0, "CmpItemKindSnippet", { fg = colors.orange })
		vim.api.nvim_set_hl(0, "CmpItemKindTabNine", { fg = "#ad5df0" })
		vim.api.nvim_set_hl(0, "CmpItemKindCopilot", { fg = "#13d8d9" })
	end,
}
