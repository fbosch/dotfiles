require("config.opts")
require("config.usercmd")
require("config.keymaps")
require("config.autocmd")
require("config.abbr")
require("config.lazy")

-- Enable OSC 52 clipboard for SSH/remote sessions
require("utils.osc52").setup()

if vim.g.vscode then
	require("config.vscode")
end