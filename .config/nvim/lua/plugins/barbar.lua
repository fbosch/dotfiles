return {
  "romgrk/barbar.nvim",
  dependencies = { "kyazdani42/nvim-web-devicons" },
  priority = 100,
  event = "VeryLazy",
  config = function()
    require("bufferline").setup({
      animation = false,
      icon_pinned = "",
      auto_hide = true,
      maximum_padding = 6,
      diagnostics = {
            [vim.diagnostic.severity.ERROR] = { enabled = true, icon = "" },
            [vim.diagnostic.severity.WARN] = { enabled = true, icon = "" },
            [vim.diagnostic.severity.INFO] = { enabled = true, icon = "󰋼" },
            [vim.diagnostic.severity.HINT] = { enabled = true, icon = "󰌵" },
      },
    })
    -- diagnostics
    vim.api.nvim_set_hl(0, "BufferDefaultVisibleHINT", { fg = "#b279a7" })
    vim.api.nvim_set_hl(0, "BufferDefaultCurrentHINT", { fg = "#b279a7" })
    vim.api.nvim_set_hl(0, "BufferDefaultInactiveHINT", { fg = "#b279a7", bg = "#252525" })
    vim.api.nvim_set_hl(0, "BufferDefaultVisibleINFO", { fg = "#97bdde" })
    vim.api.nvim_set_hl(0, "BufferDefaultCurrentINFO", { fg = "#97bdde" })
    vim.api.nvim_set_hl(0, "BufferDefaultInactiveINFO", { fg = "#97bdde", bg = "#252525" })
    vim.api.nvim_set_hl(0, "BufferDefaultVisibleERROR", { fg = "#DE6E7C" })
    vim.api.nvim_set_hl(0, "BufferDefaultCurrentERROR", { fg = "#DE6E7C" })
    vim.api.nvim_set_hl(0, "BufferDefaultInactiveERROR", { fg = "#DE6E7C", bg = "#252525" })
    vim.api.nvim_set_hl(0, "BufferDefaultVisibleWARN", { fg = "#D68C67" })
    vim.api.nvim_set_hl(0, "BufferDefaultCurrentWARN", { fg = "#D68C67" })
    vim.api.nvim_set_hl(0, "BufferDefaultInactiveWARN", { fg = "#D68C67", bg = "#252525" })
  end,
}
