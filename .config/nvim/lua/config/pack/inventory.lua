local M = {}

local enabled_by_name = {}
local disabled_by_name = {}
local registered_names = {}

local function sorted_keys(values)
	local keys = vim.tbl_keys(values)
	table.sort(keys)
	return keys
end

local function valid_package_name(name)
	return type(name) == "string"
		and name ~= ""
		and name ~= "."
		and name ~= ".."
		and name:find("\0", 1, true) == nil
		and name:find("/", 1, true) == nil
		and name:find("\\", 1, true) == nil
end

local function valid_version(version)
	return type(version) == "string" or (type(version) == "table" and pcall(version.has, version, "1"))
end

local function has_triggers(plugin)
	return #(plugin.events or {}) > 0
		or #(plugin.commands or {}) > 0
		or #(plugin.filetypes or {}) > 0
		or #(plugin.keys or {}) > 0
end

local function validate_string_list(plugin, field)
	local values = plugin[field]
	if values == nil then
		return
	end

	assert(vim.islist(values) and #values > 0, ("native %s must be a non-empty list: %s"):format(field, plugin.name))
	for _, value in ipairs(values) do
		assert(
			type(value) == "string" and value ~= "",
			("native %s entries must be non-empty strings: %s"):format(field, plugin.name)
		)
	end
end

local function validate_events(plugin)
	if plugin.events == nil then
		return
	end

	assert(vim.islist(plugin.events) and #plugin.events > 0, "native events must be a non-empty list: " .. plugin.name)
	for _, event in ipairs(plugin.events) do
		local name = type(event) == "table" and event[1] or event
		assert(type(name) == "string" and name ~= "", "native event name is required: " .. plugin.name)
		if type(event) == "table" then
			assert(
				event.pattern == nil or type(event.pattern) == "string",
				"native event pattern must be a string: " .. plugin.name
			)
		end
	end
end

local function validate_keys(plugin)
	if plugin.keys == nil then
		return
	end

	assert(vim.islist(plugin.keys) and #plugin.keys > 0, "native keys must be a non-empty list: " .. plugin.name)
	for _, key in ipairs(plugin.keys) do
		assert(type(key) == "table", "native key must be a table: " .. plugin.name)
		assert(type(key[1]) == "string" and key[1] ~= "", "native key lhs is required: " .. plugin.name)
		assert(type(key[2]) == "function", "native key callback is required: " .. plugin.name)
		assert(
			key.mode == nil or type(key.mode) == "string" or vim.islist(key.mode),
			"native key mode must be a string or list: " .. plugin.name
		)
		if type(key.mode) == "table" then
			assert(#key.mode > 0, "native key mode list cannot be empty: " .. plugin.name)
			for _, mode in ipairs(key.mode) do
				assert(
					type(mode) == "string" and mode ~= "",
					"native key modes must be non-empty strings: " .. plugin.name
				)
			end
		end
		assert(key.desc == nil or type(key.desc) == "string", "native key desc must be a string: " .. plugin.name)
		assert(key.expr == nil or type(key.expr) == "boolean", "native key expr must be boolean: " .. plugin.name)
		assert(key.silent == nil or type(key.silent) == "boolean", "native key silent must be boolean: " .. plugin.name)
		assert(
			key.replace == nil or type(key.replace) == "boolean",
			"native key replace must be boolean: " .. plugin.name
		)
	end
end

local function validate_dependencies(plugin)
	if plugin.dependencies == nil then
		return
	end

	assert(vim.islist(plugin.dependencies), "native dependencies must be a list: " .. plugin.name)
	local dependencies = {}
	for _, dependency in ipairs(plugin.dependencies) do
		assert(type(dependency) == "string", "native dependency must be a name: " .. plugin.name)
		assert(dependency ~= plugin.name, "native plugin cannot depend on itself: " .. plugin.name)
		assert(dependencies[dependency] == nil, "duplicate native dependency: " .. plugin.name .. " -> " .. dependency)
		dependencies[dependency] = true
	end
end

local function validate_plugin(plugin)
	assert(valid_package_name(plugin.name), "native plugin name must be one path segment")
	assert(type(plugin.src) == "string" and plugin.src ~= "", "native plugin source is required for " .. plugin.name)
	assert(registered_names[plugin.name] == nil, "duplicate native plugin registration: " .. plugin.name)
	assert(plugin.module == nil or type(plugin.module) == "string", "native module must be a string: " .. plugin.name)
	assert(plugin.opts == nil or type(plugin.opts) == "table", "native opts must be a table: " .. plugin.name)
	assert(plugin.init == nil or type(plugin.init) == "function", "native init must be a function: " .. plugin.name)
	assert(plugin.setup == nil or type(plugin.setup) == "function", "native setup must be a function: " .. plugin.name)
	assert(
		plugin.version == nil or valid_version(plugin.version),
		"native version must be a Git ref or vim.VersionRange: " .. plugin.name
	)
	assert(
		plugin.opts == nil or plugin.setup == nil,
		"native plugin cannot define both opts and setup: " .. plugin.name
	)
	assert(
		plugin.startup == nil or type(plugin.startup) == "boolean",
		"native startup must be boolean: " .. plugin.name
	)
	assert(plugin.root == nil or type(plugin.root) == "boolean", "native root must be boolean: " .. plugin.name)
	assert(
		plugin.enabled == nil or type(plugin.enabled) == "function",
		"native enabled must be a function: " .. plugin.name
	)
	assert(
		plugin.condition == nil or type(plugin.condition) == "function",
		"native condition must be a function: " .. plugin.name
	)
	validate_string_list(plugin, "commands")
	validate_string_list(plugin, "filetypes")
	validate_events(plugin)
	validate_keys(plugin)
	validate_dependencies(plugin)

	if plugin.root == false then
		assert(plugin.startup ~= true, "native dependency-only plugin cannot be startup-loaded: " .. plugin.name)
		assert(plugin.condition == nil, "native dependency-only plugin cannot have a condition: " .. plugin.name)
		assert(has_triggers(plugin) == false, "native dependency-only plugin cannot have triggers: " .. plugin.name)
	elseif plugin.startup == true then
		assert(has_triggers(plugin) == false, "native startup plugin cannot have triggers: " .. plugin.name)
	end
end

local function register_one(plugin)
	validate_plugin(plugin)
	registered_names[plugin.name] = true

	if plugin.enabled ~= nil then
		local ok, enabled = xpcall(plugin.enabled, debug.traceback)
		assert(ok, ("native enabled predicate failed: %s\n%s"):format(plugin.name, enabled))
		assert(type(enabled) == "boolean", "native enabled predicate must return a boolean: " .. plugin.name)
		if enabled == false then
			disabled_by_name[plugin.name] = true
			return
		end
	end

	local normalized = vim.deepcopy(plugin)
	if normalized.root ~= false and normalized.startup ~= true and has_triggers(normalized) == false then
		normalized.events = { { "User", pattern = "PackReady" } }
	end
	enabled_by_name[normalized.name] = normalized
end

function M.register(declaration)
	if declaration.name ~= nil then
		register_one(declaration)
		return
	end

	assert(
		vim.islist(declaration) and #declaration > 0,
		"native plugin registration must be a plugin or non-empty list"
	)
	for _, plugin in ipairs(declaration) do
		register_one(plugin)
	end
end

function M.current()
	local enabled = vim.deepcopy(enabled_by_name)
	local enabled_names = sorted_keys(enabled)

	local specs = {}
	for _, name in ipairs(enabled_names) do
		local plugin = enabled[name]
		table.insert(specs, {
			name = name,
			src = plugin.src,
			version = vim.deepcopy(plugin.version),
		})
	end

	return {
		enabled_by_name = enabled,
		enabled_names = enabled_names,
		pack_specs = specs,
		disabled_names = sorted_keys(disabled_by_name),
	}
end

return M
