return function()
  require("fzf-lua").setup({
    previewers = {
      bat = {
        cmd = "bat",
        args = "--style=numbers,changes --color=always --line-range=:50",
        theme = 'Zenwritten Dark',
        config = nil 
      }
    },
    files = {
      previewer = 'bat',
      prompt = "Files ",
      git_icons = true
    },
    keymap = {
      builtin = {
        ["K"] = "preview-page-up",
        ["J"] = "preview-page-down",
      }, },
  })
end
