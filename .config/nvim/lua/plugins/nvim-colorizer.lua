return {
  "nvchad/nvim-colorizer.lua",
  event = { "BufRead" },
  config = function()
    require("colorizer").setup({
      user_default_options = {
        AARRGGBB = true,
        RGB = false,
        RRGGBBAA = true,
        names = false,
      },
    })
  end,
}
