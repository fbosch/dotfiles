return {
  "kyazdani42/nvim-tree.lua",
  event = "VeryLazy",
  dependencies = { "kyazdani42/nvim-web-devicons", "mcchrish/zenbones.nvim" },
  config = function()
    require("nvim-tree").setup({
      sync_root_with_cwd = true,
      respect_buf_cwd = true,
      update_focused_file = {
        enable = true,
        -- update_root = true,
      },
      disable_netrw = true,
      hijack_netrw = true,
      renderer = {
        icons = {
          glyphs = {
            modified = "",
          },
        },
      },
      view = {
        number = true,
        relativenumber = true,
        adaptive_size = true,
        -- hide_root_folder = true,
      },
      modified = {
        enable = true,
        show_on_open_dirs = false,
      },
    })
  end,
}
