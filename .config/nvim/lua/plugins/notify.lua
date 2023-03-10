return {
  "rcarriga/nvim-notify",
  config = function()
    require("notify").setup({
      stages = "fade",
      fps = 60,
      max_width = 80,
      top_down = true,
    })

    vim.notify = require("notify")
  end,
}
