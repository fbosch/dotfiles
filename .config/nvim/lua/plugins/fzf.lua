return {
  "ibhagwan/fzf-lua",
  dependencies = { "kyazdani42/nvim-web-devicons" },
  event = "VeryLazy",
  config = function()
    require("fzf-lua").setup({
      winopts = {
        hl = { border = "rounded" },
      },
      previewers = {
        builtin = {
          hl_cursorline = "IncSearch", -- cursor line highlight
        },
        bat = {
          cmd = "bat_async",
          args = "--style=numbers,changes --color=always --line-range=:70",
          theme = "Zenwritten Dark",
        },
      },
      files = {
        previewer = "bat_async",
        args = "--style=numbers,changes --color=always --line-range=:70",
      },
      oldfiles = {
        previewer = "bat_async",
        args = "--style=numbers,changes --color=always --line-range=:70",
        cmd = {
          "fd",
          ".",
          "--type",
          "file",
          "--threads=4",
          "-E",
          "*.{png,jpg,jpeg,bmp,webp,log}",
          "-H",
          "--strip-cwd-prefix",
        },
      },
      live_grep = {
        previewer = "bat_async",
        args = "--style=numbers,changes --color=always --line-range=:70",
      },
      keymap = {
        builtin = {
          ["C-k"] = "preview-page-up",
          ["C-j"] = "preview-page-down",
        },
      },
    })
  end,
}
