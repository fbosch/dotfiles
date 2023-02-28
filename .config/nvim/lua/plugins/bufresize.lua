return {
  "kwkarlwang/bufresize.nvim",
  event = "BufRead",
  config = function() 
    require("bufresize").setup()
  end
}
