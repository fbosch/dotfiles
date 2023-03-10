return {
  "nvim-telescope/telescope.nvim",
  dependencies = { "nvim-telescope/telescope-file-browser.nvim", "kdheepak/lazygit.nvim" },
  event = "VeryLazy",
  config = function()
    local telescope = require("telescope")
    telescope.load_extension("file_browser")
    telescope.load_extension("lazygit")
    telescope.load_extension("git_worktree")
    telescope.setup({
      defaults = {
        layout_config = {
          width = 0.4,
          height = 0.4,
          scroll_speed = 1.5,
          preview_cutoff = 400,
        },
      },
      extensions = {
        file_browser = { theme = "dropdown" },
      },
      pickers = {
        find_files = {
          prompt_prefix = "🔍",
          find_command = {
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
          theme = "dropdown",
        },
        grep_string = {
          theme = "dropdown",
          disable_coordinates = true,
        },
        live_grep = {
          theme = "dropdown",
          disable_coordinates = true,
        },
        buffers = {
          theme = "dropdown",
          disable_coordinates = true,
          only_cwd = true,
          sort_mru = true,
        },
      },
    })
  end,
}
