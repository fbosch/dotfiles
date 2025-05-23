local spec = {
	{ import = "plugins.editor" },
}

if not vim.g.vscode then
	table.insert(spec, { import = "plugins.interface" })
	table.insert(spec, { import = "plugins.workflow" })
end

return spec
