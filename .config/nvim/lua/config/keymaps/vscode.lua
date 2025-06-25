local map = require("utils").set_keymap
local vscode = require("vscode")

map("n", "<leader>e", function()
	vscode.call("workbench.action.toggleSidebarVisibility")
	vscode.call("workbench.view.explorer")
	vscode.call("workbench.action.focusSideBar")
end)

map("n", "<leader>x", function()
	vscode.call("workbench.action.closeOtherEditors")
	vscode.call("workbench.action.closeEditorsInOtherGroups")
	vscode.call("workbench.action.closeSidebar")
end)

map("n", "<leader>l", function()
	vscode.call("workbench.action.findInFiles")
end)

map("n", "<leader>k", function()
	vscode.call("editor.action.showHover")
end)
