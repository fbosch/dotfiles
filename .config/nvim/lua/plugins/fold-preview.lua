return {
  "anuvyklack/fold-preview.nvim",
  dependencies = "anuvyklack/keymap-amend.nvim",
  event = "BufRead",
  config = function()
    require("fold-preview").setup({
      border = "rounded",
    })
  end,
}
