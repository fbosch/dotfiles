return {
  "anuvyklack/fold-preview.nvim",
  dependencies = 'anuvyklack/keymap-amend.nvim',
  event = "VeryLazy",
  config = function() 
    require("fold-preview").setup({
      border = 'rounded'
    })
  end
}
