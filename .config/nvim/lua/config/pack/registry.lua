local M = {}

local plugins = {}

function M.register(plugin)
	assert(type(plugin.name) == "string", "native plugin name is required")
	assert(type(plugin.src) == "string", "native plugin source is required for " .. plugin.name)
	assert(plugins[plugin.name] == nil, "duplicate native plugin registration: " .. plugin.name)
	plugins[plugin.name] = plugin
end

function M.get(name)
	return plugins[name]
end

function M.all()
	return plugins
end

return M
