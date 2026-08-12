local M = {}

local plugins = {}

local function register_one(plugin)
	assert(type(plugin.name) == "string", "native plugin name is required")
	assert(type(plugin.src) == "string", "native plugin source is required for " .. plugin.name)
	assert(plugins[plugin.name] == nil, "duplicate native plugin registration: " .. plugin.name)
	assert(
		plugin.opts == nil or plugin.setup == nil,
		"native plugin cannot define both opts and setup: " .. plugin.name
	)
	if plugin.events == nil and plugin.commands == nil and plugin.filetypes == nil and plugin.keys == nil then
		plugin.events = { { "User", pattern = "PackReady" } }
	end
	plugins[plugin.name] = plugin
end

function M.register(spec)
	if spec.name ~= nil then
		register_one(spec)
		return
	end

	assert(vim.islist(spec) and #spec > 0, "native plugin registration must be a plugin or non-empty list")
	for _, plugin in ipairs(spec) do
		register_one(plugin)
	end
end

function M.get(name)
	return plugins[name]
end

function M.all()
	return plugins
end

return M
