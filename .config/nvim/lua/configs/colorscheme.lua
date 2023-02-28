return function()
  vim.opt.ruler = true
  vim.opt.lazyredraw = true
  vim.opt.background = "dark"
  vim.opt.pumblend = 10
  vim.opt.winblend = 0
  vim.opt.scrolloff = 8
  vim.api.nvim_set_hl(0, "TreesitterContext", { bg = "#2c2c2c" })
  vim.api.nvim_set_hl(0, "SpellBad", { undercurl=true, special="#A8334C" })

  -- popup menu highlights (wilder, telescope, etc.)
  vim.api.nvim_set_hl(0, "NormalFloat", { bg = "#191919" })
  vim.api.nvim_set_hl(0, "Pmenu", { bg = "#191919" })
  vim.api.nvim_set_hl(0, "Beacon", { bg = "#bbbbbb", ctermbg = 15 })

  -- cmp highlights
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

  -- which-key
  vim.api.nvim_set_hl(0, "WhichKeyFloat", { bg = "#191919" })
  vim.api.nvim_set_hl(0, "WhichKey", { fg = "#97bdde" })

  -- notify
  vim.api.nvim_set_hl(0, "NotifyERRORBorder", { fg = "#DE6E7C" })
  vim.api.nvim_set_hl(0, "NotifyWARNBorder", { fg = "#D68C67" })
  vim.api.nvim_set_hl(0, "NotifyINFOBorder", { fg = "#2c2c2c" })
  vim.api.nvim_set_hl(0, "NotifyDEBUGBorder", { fg = "#aaaaaa" })
  vim.api.nvim_set_hl(0, "NotifyTRACEBorder", { fg = "#b279a7" })
  vim.api.nvim_set_hl(0, "NotifyERRORIcon", { fg = "#DE6E7C" })
  vim.api.nvim_set_hl(0, "NotifyWARNIcon", { fg = "#D68C67" })
  vim.api.nvim_set_hl(0, "NotifyINFOIcon", { fg = "#97bdde" })
  vim.api.nvim_set_hl(0, "NotifyDEBUGIcon", { fg = "#aaaaaa" })
  vim.api.nvim_set_hl(0, "NotifyTRACEIcon", { fg = "#b279a7" })
  vim.api.nvim_set_hl(0, "NotifyERRORTitle", { fg = "#DE6E7C" })
  vim.api.nvim_set_hl(0, "NotifyWARNTitle", { fg = "#D68C67" })
  vim.api.nvim_set_hl(0, "NotifyINFOTitle", { fg = "#bbbbbb" })
  vim.api.nvim_set_hl(0, "NotifyDEBUGTitle", { fg = "#aaaaaa" })
  vim.api.nvim_set_hl(0, "NotifyTRACETitle", { fg = "#b279a7" })

  -- diagnostics
  vim.api.nvim_set_hl(0, "BufferDefaultVisibleHINT", { fg = "#b279a7" })
  vim.api.nvim_set_hl(0, "BufferDefaultCurrentHINT", { fg = "#b279a7" })
  vim.api.nvim_set_hl(0, "BufferDefaultInactiveHINT", { fg = "#b279a7", bg = "#252525" })
  vim.api.nvim_set_hl(0, "BufferDefaultVisibleERROR", { fg = "#DE6E7C" })
  vim.api.nvim_set_hl(0, "BufferDefaultCurrentERROR", { fg = "#DE6E7C" })
  vim.api.nvim_set_hl(0, "BufferDefaultInactiveERROR", { fg = "#DE6E7C", bg = "#252525" })
  vim.api.nvim_set_hl(0, "BufferDefaultVisibleWARN", { fg = "#D68C67" })
  vim.api.nvim_set_hl(0, "BufferDefaultCurrentWARN", { fg = "#D68C67" })
  vim.api.nvim_set_hl(0, "BufferDefaultInactiveWARN", { fg = "#D68C67", bg = "#252525" })
 
  -- fold
  vim.api.nvim_set_hl(0, "Folded", { fg = "#bbbbbb", bg = "#252525" })
end
