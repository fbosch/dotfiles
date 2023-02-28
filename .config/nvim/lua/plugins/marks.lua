return {
  "chentoast/marks.nvim",
  event = "BufRead",
  config = function()
    require('marks').setup({
       bookmark_0 = {
        sign = "",
      },
    })
  end
}
