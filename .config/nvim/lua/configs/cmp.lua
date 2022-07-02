return function()
  local cmp = require("cmp")
  local lspkind = require("lspkind")

  vim.highlight.create("CmpItemAbbrDeprecated", { guibg=0, guifg="#bbbbbb", gui="strikethrough"})
  vim.highlight.create("CmpItemAbbrMatch", { guibg=0, guifg="#aaaaaa" })
  vim.highlight.create("CmpItemAbbrMatchFuzzy", { guibg=0, guifg="#aaaaaa" })
  vim.highlight.create("CmpItemKindVariable", { guibg=0, guifg="#97bdde" })
  vim.highlight.create("CmpItemKindInterface", { guibg=0, guifg="#97bdde" })
  vim.highlight.create("CmpItemKindText", { guibg=0, guifg="#97bdde" })
  vim.highlight.create("CmpItemKindFunction", { guibg=0, guifg="#b279a7" })
  vim.highlight.create("CmpItemKindMethod", { guibg=0, guifg="#b279a7" })
  vim.highlight.create("CmpItemKindKeyword", { guibg=0, guifg="#bbbbbb" })
  vim.highlight.create("CmpItemKindProperty", { guibg=0, guifg="#ffffff" })
  vim.highlight.create("CmpItemKindUnit", { guibg=0, guifg="#ffffff" })

  cmp.setup({
    snippet = {
      expand = function(args)
        require("luasnip").lsp_expand(args.body)
      end
    },
    window = {
      completion = cmp.config.window.bordered(),
      documentation = cmp.config.window.bordered()
    },
    formatting = {
      format = lspkind.cmp_format({
        mode = 'symbol_text',
        maxwidth = 50
      })
    },
    sources = cmp.config.sources({
      { name = "nvim_lsp" },
      { name = "buffer" },
      { name = "path" }
    }),
    mapping = cmp.mapping.preset.insert({
      ["<C-f>"] = cmp.mapping.scroll_docs(4),
      ["<C-d>"] = cmp.mapping.scroll_docs(-4),
      ["<C-Space>"] = cmp.mapping.complete(),
      ["<C-e>"] = cmp.mapping.abort(),
      ["<CR>"] = cmp.mapping.confirm({ select = true })
    })
  })
end
