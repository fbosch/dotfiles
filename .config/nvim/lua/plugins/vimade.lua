return {
  "TaDaa/vimade",
  event = "VeryLazy",
  config = function()
    vim.g.vimade = {
      fadelevel = 0.6,
      usecursorhold = true,
      updatetime = 0,
      detecttermcolors = true,
      enablescroll = 1,
      enabletreesitter = 1,
    }
  end,
}
