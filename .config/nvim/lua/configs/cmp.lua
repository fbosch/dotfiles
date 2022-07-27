return function()
  local cmp = require("cmp")
  local types = require("cmp.types")
  local lspkind = require("lspkind")
  vim.defer_fn(function()
    cmp.setup({
      completion = {
        completeopt = "menu,menuone,noinsert"
      },
      window = {
        completion = cmp.config.window.bordered(),
        documentation = cmp.config.window.bordered()
      },
      formatting = {
       format = function (entry, vim_item)
        if entry.source.name == "copilot" then
          vim_item.kind = ""
          vim_item.kind_hl_group = "CmpItemKindCopilot"
          return vim_item
          end
          return lspkind.cmp_format({ with_text = false, maxwidth = 50 })(entry, vim_item)
        end
      },
      sources = cmp.config.sources({
        { name = "copilot" },
        { name = "nvim_lsp" },
        { name = "buffer" },
        -- { name = "luasnip" },
        { name = "fish" },
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
  end, 200)
end

