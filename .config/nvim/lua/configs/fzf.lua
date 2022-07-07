return function()
  require("fzf-lua").setup({
    previewers = {
      bat = {
        cmd = "bat",
        args = "--style=numbers,changes --color=always --line-range=:70",
        theme = 'Zenwritten Dark',
        config = nil 
      }
    },
    files = {
      previewer = 'bat',
      prompt = "Files ",
    },
    keymap = {
      builtin = {
        ["K"] = "preview-page-up",
        ["J"] = "preview-page-down",
      }, 
    },
  })
end
