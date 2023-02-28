return {
  "kyazdani42/nvim-tree.lua",
  dependencies =  { "kyazdani42/nvim-web-devicons", "mcchrish/zenbones.nvim" },
  config = function()
    require("nvim-tree").setup({
      disable_netrw = true,
      hijack_netrw = true,
      view = {
        number = true,
        relativenumber = true,
        adaptive_size = true,
        -- hide_root_folder = true
      }
    })

    -- highlights
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
  end
}
