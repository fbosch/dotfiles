return {
  "lukas-reineke/indent-blankline.nvim",
  event = "VeryLazy",
  config = function()
    vim.opt.list = true

    require("indent_blankline").setup({
      char = "▎",
      context_char = "▎",
      treesitter = true,
      show_current_context_start = true,
      show_current_context = true,
    })
  end,
}
