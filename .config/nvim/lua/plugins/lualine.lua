return {
  "nvim-lualine/lualine.nvim",
  event = "ColorSchemePre",
  priority = 100,
  dependencies = {
    "kyazdani42/nvim-web-devicons",
    "f-person/git-blame.nvim"
  },
  config = function()
    vim.g.gitblame_display_virtual_text = 0 -- Disable virtual text
    vim.g.gitblame_date_format = "%r"
    vim.g.gitblame_message_template = " <author>  﨟<date>"
    local git_blame = require('gitblame')
    require("lualine").setup({
      options = { theme = "auto" },
      extensions = { "fugitive", "symbols-outline" },
      sections = {
        lualine_c = { require("auto-session-library").current_session_name },
        lualine_y = {
          "filetype"
        },
        lualine_x = {
          { git_blame.get_current_blame_text, cond = git_blame.is_blame_text_available }
        }
      }
    })
  end
}
