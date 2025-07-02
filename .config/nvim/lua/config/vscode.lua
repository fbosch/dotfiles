local map = require("utils").set_keymap
local vscode = require("vscode")

-- forward notifications to vscode
vim.notify = function(msg, level, opts)
	local severity = ({
		[vim.log.levels.ERROR] = "error",
		[vim.log.levels.WARN] = "warning",
		[vim.log.levels.INFO] = "info",
		[vim.log.levels.DEBUG] = "info",
		[vim.log.levels.TRACE] = "info",
	})[level or vim.log.levels.INFO] or "info"
	vscode.notify(msg, severity)
end

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

map("n", "u", function()
	vscode.call("undo")
end)

map("n", "<C-r>", function()
	vscode.call("redo")
end)
