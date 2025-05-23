return {
	{ import = "plugins.core" },
	{ import = "plugins.lang" },
	{ import = "plugins.ui", enabled = not vim.g.vscode },
	{ import = "plugins.workflow", enabled = not vim.g.vscode },
	{ import = "plugins.ai" },
	{ import = "plugins.misc" },
}
