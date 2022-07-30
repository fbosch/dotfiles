return function()
  local function get_tree_size()
    return vim.api.nvim_win_get_width(0)
  end
  vim.defer_fn(function()
    require("nvim-tree").setup({
      disable_netrw = true,
      hijack_netrw = true,
      view = {
        adaptive_size = true,
        hide_root_folder = true
      }
    })
    vim.schedule(function()
      local nvim_tree_events = require("nvim-tree.events")
      local bufferline_state = require("bufferline.state")

      nvim_tree_events.on_tree_open(function()
        bufferline_state.set_offset(31)
      end)

      nvim_tree_events.on_tree_close(function()
        bufferline_state.set_offset(0)
      end)
    end)
  end, 400)
end
