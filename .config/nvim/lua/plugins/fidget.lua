return {
  "j-hui/fidget.nvim",
  event = "BufRead",
  config = function() 
    require("fidget").setup()
  end
}
