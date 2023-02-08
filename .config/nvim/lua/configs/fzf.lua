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
      cmd = { "fd", ".", "--type", "file", "--threads=4", "-E", "*.{png,jpg,jpeg,bmp,webp,log}", '-H', "--strip-cwd-prefix" },
    },
    keymap = {
      builtin = {
        ["K"] = "preview-page-up",
        ["J"] = "preview-page-down",
      },
    },
  })
end
