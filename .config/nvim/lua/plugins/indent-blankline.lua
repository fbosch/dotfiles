return {
  "lukas-reineke/indent-blankline.nvim",
  event = "VeryLazy",
  config = function()
    vim.opt.list = true
    require("indent_blankline").setup({
      show_current_context = true,
    })
  end
}
