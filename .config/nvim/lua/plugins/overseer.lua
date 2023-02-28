return {
  "stevearc/overseer.nvim",
  event = "VeryLazy",
  config = function() 
    require("overseer").setup({
      form = {
        border = "rounded",
      }
    })
  end
}
