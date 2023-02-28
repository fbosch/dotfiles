return {
  "ray-x/sad.nvim",
  dependencies = { "ray-x/guihua.lua", run = "cd lua/fzy && make" },
  config = function()
    require("sad").setup()
  end
}
