return function()
  require("fzf-lua").setup({
    previewers = {
      builtin = {
        hl_cursorline = 'IncSearch', -- cursor line highlight
      },
      bat = {
        cmd = "bat_async",
        args = "--style=numbers,changes --color=always --line-range=:70",
        theme = 'Zenwritten Dark',
      }
    },
    files = {
      previewer = 'bat_async',
      args = "--style=numbers,changes --color=always --line-range=:70",
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
