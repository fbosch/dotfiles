return {
  "rmagatti/auto-session",
  config = function()
    require("auto-session").setup({
      auto_session_root_dir = vim.fn.expand('~/.config')..'/nvim/.sessions//',
      log_level = "error",
    })
  end
}
