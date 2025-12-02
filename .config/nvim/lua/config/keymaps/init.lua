require("config.keymaps.core")
require("config.keymaps.navigation")
require("config.keymaps.yank")
require("config.keymaps.editing")

-- Defer plugin keymaps loading to avoid loading heavy utils at startup
vim.api.nvim_create_autocmd("User", {
	pattern = "VeryLazy",
	callback = function()
		require("config.keymaps.plugins")
	end,
	once = true,
})
