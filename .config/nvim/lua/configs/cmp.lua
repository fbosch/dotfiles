return function()
  local cmp = require("cmp")
  local types = require("cmp.types")
  local lspkind = require("lspkind")
  vim.schedule(function()
    require("luasnip.loaders.from_snipmate").lazy_load({ paths = "~/.config/nvim/snippets" })
    cmp.setup({
      completion = {
        completeopt = "menu,menuone,noinsert"
      },
      window = {
        completion = cmp.config.window.bordered(),
        documentation = cmp.config.window.bordered()
      },
      snippet = {
        expand = function(args)
          require("luasnip").lsp_expand(args.body)
        end
      },
      formatting = {
        format = lspkind.cmp_format({ with_text = false, maxwidth = 50 })
      },
      sources = cmp.config.sources({
        { name = "nvim_lsp" },
        { name = "buffer" },
        { name = "luasnip" },
        { name = "emoji" },
        { name = "fish" },
        { name = "spell" },
        { name = "nvim_lua" },
      }),
      mapping = cmp.mapping.preset.insert({
        ["<C-f>"] = cmp.mapping.scroll_docs(4),
        ["<C-d>"] = cmp.mapping.scroll_docs(-4),
        ["<C-e>"] = cmp.mapping.abort(),
        -- ["<Space>"] = cmp.mapping.confirm({ select = true }),
        ["<CR>"] = cmp.mapping.confirm({ select = false }),
        ["<C-j>"] = cmp.mapping.select_next_item({ behavior = types.cmp.SelectBehavior.Select }),
        ["<C-k>"] = cmp.mapping.select_prev_item({ behavior = types.cmp.SelectBehavior.Select })
      })
    })
  end)
end


