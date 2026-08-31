local M = {}

local function append_declarations(collected, declarations, module_name)
	local invalid_return = ("native plugin module %s must return a declaration or non-empty list"):format(module_name)
	assert(type(declarations) == "table", invalid_return)
	if declarations.name ~= nil then
		table.insert(collected, declarations)
		return
	end

	assert(vim.islist(declarations) and #declarations > 0, invalid_return)
	for index, declaration in ipairs(declarations) do
		assert(
			type(declaration) == "table",
			("native plugin module %s declaration #%d must be a table"):format(module_name, index)
		)
		table.insert(collected, declaration)
	end
end

function M.load()
	local declarations = {}
	for _, category in ipairs({ "core", "ui", "lang", "workflow", "ai", "misc" }) do
		local dir = vim.fs.joinpath(vim.fn.stdpath("config"), "lua", "plugins", category)
		local modules, module_names = require("utils.fn").require_dir_modules(dir)
		for index, module_declarations in ipairs(modules) do
			append_declarations(declarations, module_declarations, module_names[index])
		end
	end
	return declarations
end

return M
