return {
  "kyazdani42/nvim-tree.lua",
  event = "VeryLazy",
  dependencies = { "kyazdani42/nvim-web-devicons", "mcchrish/zenbones.nvim" },
  config = function()
    require("nvim-tree").setup({
      disable_netrw = true,
      hijack_netrw = true,
      view = {
        number = true,
        relativenumber = true,
        adaptive_size = true,
      }
    })
  end
}
