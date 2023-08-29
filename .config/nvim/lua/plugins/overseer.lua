return {
  "stevearc/overseer.nvim",
  event = "VeryLazy",
  config = function()
    require("overseer").setup({
      form = {
        border = "rounded",
        zindex = 40,
        -- Dimensions can be integers or a float between 0 and 1 (e.g. 0.4 for 40%)
        -- min_X and max_X can be a single value or a list of mixed integer/float types.
        min_width = 80,
        max_width = 0.9,
        width = nil,
        min_height = 10,
        max_height = 0.9,
        height = nil,
        -- Set any window options here (e.g. winhighlight)
        win_opts = {
          winblend = 10,
        },
      },
    })
  end,
}
