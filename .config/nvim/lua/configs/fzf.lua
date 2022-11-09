return function()
  vim.schedule(function()
    require("fzf-lua").setup({
      previewers = {
        builtin = {
          hl_cursorline = "Search", -- cursor line highlight
        },
        bat = {
          cmd = "bat",
          args = "--style=numbers,changes --color=always --line-range=:70",
          theme = 'Zenwritten Dark',
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
  end)
end
