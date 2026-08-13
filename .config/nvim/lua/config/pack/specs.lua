local M = {}

function M.get()
	local native_plugins = require("config.pack.registry").all()
	local specs = {}

	for name, plugin in pairs(native_plugins) do
		table.insert(specs, {
			name = name,
			src = plugin.src,
			version = plugin.version,
		})
	end

	table.sort(specs, function(left, right)
		return left.name < right.name
	end)
	assert(#specs == 68, ("expected 68 application plugins, got %d"):format(#specs))

	return specs
end

return M
