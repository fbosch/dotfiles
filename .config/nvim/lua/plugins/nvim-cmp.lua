return {
  "hrsh7th/nvim-cmp",
  dependencies = {
    "nvim-treesitter/nvim-treesitter",
    "onsails/lspkind.nvim",
    "hrsh7th/nvim-cmp",
    "f3fora/cmp-spell",
    "mtoohey31/cmp-fish",
    "hrsh7th/cmp-nvim-lua",
    "hrsh7th/cmp-emoji",
    "saadparwaiz1/cmp_luasnip",
    "hrsh7th/cmp-nvim-lsp",
    "hrsh7th/cmp-path",
    "hrsh7th/cmp-buffer",
  },
  event = "VeryLazy",
  config = function()
    local cmp = require("cmp")
    local types = require("cmp.types")
    local lspkind = require("lspkind")
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
  
    -- highlights
    vim.api.nvim_set_hl(0, "CmpItemAbbrDeprecated", { bg=0, fg="#bbbbbb", strikethrough = true })
    vim.api.nvim_set_hl(0, "CmpItemAbbrMatch", { bg=0, fg="#aaaaaa" })
    vim.api.nvim_set_hl(0, "CmpItemAbbrMatchFuzzy", { bg=0, fg="#aaaaaa" })
    vim.api.nvim_set_hl(0, "CmpItemKindVariable", { bg=0, fg="#97bdde" })
    vim.api.nvim_set_hl(0, "CmpItemKindInterface", { bg=0, fg="#97bdde" })
    vim.api.nvim_set_hl(0, "CmpItemKindText", { bg=0, fg="#97bdde" })
    vim.api.nvim_set_hl(0, "CmpItemKindFunction", { bg=0, fg="#b279a7" })
    vim.api.nvim_set_hl(0, "CmpItemKindMethod", { bg=0, fg="#b279a7" })
    vim.api.nvim_set_hl(0, "CmpItemKindKeyword", { bg=0, fg="#bbbbbb" })
    vim.api.nvim_set_hl(0, "CmpItemKindProperty", { bg=0, fg="#ffffff" })
    vim.api.nvim_set_hl(0, "CmpItemKindUnit", { bg=0, fg="#ffffff" })
    vim.api.nvim_set_hl(0, "CmpItemKindSnippet", { bg=0, fg="#D68C67" })
  end
}
