return {
  "stevearc/dressing.nvim",
  config = function() 
    require("dressing").setup({
      input = {
        enabled = true,
        border = 'rounded',
        win_options = {
          winblend = 20,
        }
      },
    })
  end
}
