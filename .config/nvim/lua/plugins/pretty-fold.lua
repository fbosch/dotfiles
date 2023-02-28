return {
  "anuvyklack/pretty-fold.nvim",
  event = "BufRead",
  config = function()
    require("pretty-fold").setup({
      fill_char = "‗",
    })
  end
}
