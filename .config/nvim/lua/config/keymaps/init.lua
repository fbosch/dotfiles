require("config.keymaps.core")
require("config.keymaps.navigation")
require("config.keymaps.yank")
require("config.keymaps.editing")
if vim.g.vscode then
	require("config.keymaps.vscode")
end
require("config.keymaps.plugins")
