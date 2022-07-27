return function()
  vim.g.gitblame_display_virtual_text = 0 -- Disable virtual text
  local git_blame = require('gitblame')
  vim.g.gitblame_date_format = "%r"
  vim.g.gitblame_display_virtual_text = 0
  vim.g.gitblame_message_template = " <author>  﨟<date>"
  require("lualine").setup({
    options = { theme = "auto" },
    extensions = { "fugitive", "symbols-outline" },
    sections = {
      -- lualine_c = { require("auto-session-library").current_session_name },
      lualine_c = {},
      lualine_y = {
        "filetype"
      },
      lualine_x = {
        { git_blame.get_current_blame_text, cond = git_blame.is_blame_text_available }
      }
    }
  })
end
