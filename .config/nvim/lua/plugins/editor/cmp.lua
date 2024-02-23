return {
	"hrsh7th/nvim-cmp",
	dependencies = {

		"nvim-treesitter/nvim-treesitter",
		"L3MON4D3/LuaSnip",
		"nvim-lua/plenary.nvim",
		"onsails/lspkind.nvim",
		"hrsh7th/nvim-cmp",
		"f3fora/cmp-spell",
		"hrsh7th/cmp-nvim-lua",
		"hrsh7th/cmp-emoji",
		"saadparwaiz1/cmp_luasnip",
		"hrsh7th/cmp-nvim-lsp",
		"hrsh7th/cmp-path",
		"hrsh7th/cmp-buffer",
		"David-Kunz/cmp-npm",
		{
			"tzachar/cmp-tabnine",
			build = "./install.sh",
		},
	},
	event = { "InsertEnter" },
	config = function()
		local cmp = require("cmp")
		local types = require("cmp.types")
		local lspkind = require("lspkind")
		require("cmp-npm").setup({})
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
				format = function(entry, vim_item)
					vim_item.kind = lspkind.symbolic(vim_item.kind, { mode = "symbol" })
					-- vim_item.menu = source_mapping[entry.source.name]
					if entry.source.name == "cmp_tabnine" then
						local detail = (entry.completion_item.data or {}).detail
						vim_item.kind = ""
						if detail and detail:find(".*%%.*") then
							vim_item.kind = vim_item.kind .. " " .. detail
						end

						if (entry.completion_item.data or {}).multiline then
							vim_item.kind = vim_item.kind .. " " .. "[ML]"
						end
					end
					local maxwidth = 80
					vim_item.abbr = string.sub(vim_item.abbr, 1, maxwidth)
					return vim_item
				end,
			},
			sources = cmp.config.sources({
				{ name = "nvim_lsp", max_item_count = 10 },
				{ name = "buffer", max_item_count = 3 },
				-- { name = "luasnip", max_item_count = 4 },
				{ name = "emoji", max_item_count = 20 },
				{ name = "spell", max_item_count = 3 },
				{ name = "nvim_lua", max_item_count = 5 },
				{ name = "npm", max_item_count = 3 },
				{ name = "cmp_tabnine", max_item_count = 5 },
			}),
			mapping = cmp.mapping.preset.insert({
				["<C-f>"] = cmp.mapping.scroll_docs(4),
				["<C-d>"] = cmp.mapping.scroll_docs(-4),
				["<C-e>"] = cmp.mapping.abort(),
				-- ["<Space>"] = cmp.mapping.confirm({ select = true }),
				["<CR>"] = cmp.mapping.confirm({ select = false }),
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
	end,
}
