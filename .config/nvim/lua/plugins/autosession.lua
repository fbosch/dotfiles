return {
  "rmagatti/auto-session",
  config = function()
    require("auto-session").setup({
      auto_session_root_dir = vim.fn.expand("~/.config") .. "/nvim/.sessions//",
      -- auto_session_use_git_branch = true,
      auto_restore_enabled = true,
      log_level = "error",
      cwd_change_handling = {
        restore_upcoming_session = true,
        post_cwd_changed_hook = function()
          vim.cmd(":VimadeRedraw")
          vim.cmd(":syntax on")
        end,
      },
    })
  end,
}
