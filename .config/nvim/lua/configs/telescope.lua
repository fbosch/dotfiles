return function()
  local telescope = require("telescope")
  local actions = require("telescope.actions")
  telescope.load_extension "file_browser"
  telescope.setup({
    defaults = {
      layout_config = {
        scroll_speed = 1.5,
        preview_cutoff = 300
      },
    },
    extensions = {
      file_browser = { theme = "dropdown" },
    },
    pickers = {
      find_files = {
        prompt_prefix = "🔍",
        find_command = { "fd", ".", "--type", "file", "--threads=8", "-E", "*.{png,jpg,jpeg,bmp,webp,log}" },
        previewer = false,
        theme = "dropdown"
      },
      grep_string = {
        theme = "dropdown",
        disable_coordinates = true
      },
      live_grep = {
        theme = "dropdown",
        disable_coordinates = true
      },
      buffers = {
        theme = "dropdown",
        only_cwd = true,
        sort_mru = true
      }
    }
  })
end
