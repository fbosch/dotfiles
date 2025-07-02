require("config.opts")
require("config.usercmd")
require("config.keymaps")
require("config.autocmd")
require("config.abbr")
require("config.lazy")

if vim.g.vscode then
	require("config.vscode")
end