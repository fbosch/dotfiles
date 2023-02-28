return {
  "folke/trouble.nvim",
  dependencies = { "kyazdani42/nvim-web-devicons" },
  event = "CursorHold",
  config = function()
    require("trouble").setup()
  end
}
