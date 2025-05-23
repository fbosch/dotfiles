local not_vscode = not vim.g.vscode

return {
	{ import = "plugins.core" },
	{ import = "plugins.lang" },
	{ import = "plugins.editor" },
	{ import = "plugins.ui", enabled = not_vscode },
	{ import = "plugins.workflow", enabled = not_vscode },
}
