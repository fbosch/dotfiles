return function()
  vim.opt.ruler = true
  vim.opt.lazyredraw = true
  vim.opt.background = "dark"
  vim.opt.pumblend = 10
  vim.opt.winblend = 0
  vim.opt.scrolloff = 8
  vim.highlight.create("TreesitterContext", { guibg = "#2c2c2c" })

  -- popup menu highlights (wilder, telescope, etc.)
  vim.highlight.create("NormalFloat", { guibg = "#191919" })
  vim.highlight.create("Pmenu", { guibg = "#191919" })
  vim.highlight.create("Beacon", { guibg = "#bbbbbb", ctermbg = 15 })

  -- cmp highlights
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
  vim.highlight.create("CmpItemKindSnippet", { guibg=0, guifg="#D68C67" })

  -- which-key
  vim.highlight.create("WhichKeyFloat", { guibg = "#191919" })
  vim.highlight.create("WhichKey", { guifg = "#97bdde" })

  -- notify
  vim.highlight.create("NotifyERRORBorder", { guifg = "#DE6E7C" })
  vim.highlight.create("NotifyWARNBorder", { guifg = "#D68C67" })
  vim.highlight.create("NotifyINFOBorder", { guifg = "#2c2c2c" })
  vim.highlight.create("NotifyDEBUGBorder", { guifg = "#aaaaaa" })
  vim.highlight.create("NotifyTRACEBorder", { guifg = "#b279a7" })
  vim.highlight.create("NotifyERRORIcon", { guifg = "#DE6E7C" })
  vim.highlight.create("NotifyWARNIcon", { guifg = "#D68C67" })
  vim.highlight.create("NotifyINFOIcon", { guifg = "#97bdde" })
  vim.highlight.create("NotifyDEBUGIcon", { guifg = "#aaaaaa" })
  vim.highlight.create("NotifyTRACEIcon", { guifg = "#b279a7" })
  vim.highlight.create("NotifyERRORTitle", { guifg = "#DE6E7C" })
  vim.highlight.create("NotifyWARNTitle", { guifg = "#D68C67" })
  vim.highlight.create("NotifyINFOTitle", { guifg = "#bbbbbb" })
  vim.highlight.create("NotifyDEBUGTitle", { guifg = "#aaaaaa" })
  vim.highlight.create("NotifyTRACETitle", { guifg = "#b279a7" })
end
