local map = require("utils").set_keymap
local vscode = require("utils.vscode")

map("n", "<C-l>", vscode.call("workbench.action.nextEditor"))
map("n", "<C-h>", vscode.call("workbench.action.previousEditor"))

map(
	"n",
	"<leader>x",
	table.concat({
		vscode.call("workbench.action.closeOtherEditors"),
		vscode.call("workbench.action.closeEditorsInOtherGroups"),
		vscode.call("workbench.action.closeSidebar"),
	}, "<BAR>")
)

map("n", "<leader>e", vscode.call("workbench.action.toggleSidebarVisibility"))
map("i", "<Esc>", "<ESC><BAR>" .. vscode.call("vscode-neovim.escape"))
map("n", "<C-p>", vscode.call("workbench.action.quickOpen"))
map("n", "<leader>l", vscode.call("workbench.action.findInFiles"))
