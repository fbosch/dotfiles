return {
  "folke/todo-comments.nvim",
  dependencies = {
   "nvim-lua/plenary.nvim"
  },
  event = "ColorSchemePre",
  config = function()
    require("todo-comments").setup()
  end
}
