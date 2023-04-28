return {
  "DNLHC/glance.nvim",
  event = "VeryLazy",
  config = function()
    require("glance").setup({
      height = 18,
      width = 60,
      border = {
        enable = true,
      },
    })
  end,
}
