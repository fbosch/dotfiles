return function()
  vim.schedule(function()
    require("nvim-tree").setup({
      disable_netrw = true,
      hijack_netrw = true,
      view = {
        adaptive_size = true,
        hide_root_folder = true
      }
    })
  end)
end
