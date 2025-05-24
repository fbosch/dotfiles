return {
	{ import = "plugins.core" },
	{ import = "plugins.lang", enabled = not vim.g.vscode },
	{ import = "plugins.ui", enabled = not vim.g.vscode },
	{ import = "plugins.workflow", enabled = not vim.g.vscode },
	{ import = "plugins.ai", enabled = not vim.g.vscode },
	{ import = "plugins.misc" },
}
