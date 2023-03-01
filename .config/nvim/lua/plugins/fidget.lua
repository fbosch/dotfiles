return {
  "j-hui/fidget.nvim",
  event = "BufRead",
  config = function() 
    require("fidget").setup({
      text = {
        spinner = "dots_scrolling",
        done = " "
      },
      window = {
        relative = "editor",
        border = "rounded",
        blend = 200
      }
    })
  end
}
