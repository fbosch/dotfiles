-- fix for the Z command
vim.api.nvim_create_user_command("Z", "wa | qa", {})
