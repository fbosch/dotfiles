local M = {}

local marker_name = ".nvim-pack-disabled"

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

local function package_root()
	return vim.fs.joinpath(vim.fn.stdpath("data"), "site", "pack", "core", "opt")
end

local function package_path(name)
	assert(valid_package_name(name), "native package name must be one path segment")
	local root = package_root()
	local path = vim.fs.joinpath(root, name)
	assert(vim.fs.dirname(path) == root, "native package path escaped package root: " .. name)
	return path
end

local function marker_path(path)
	return vim.fs.joinpath(path, marker_name)
end

local function validate_input(input)
	assert(type(input) == "table", "native package synchronization input must be a table")
	assert(vim.islist(input.specs), "native package synchronization specs must be a list")
	assert(vim.islist(input.disabled_names), "native disabled package names must be a list")

	local enabled = {}
	for _, spec in ipairs(input.specs) do
		assert(type(spec) == "table", "native package spec must be a table")
		assert(valid_package_name(spec.name), "native package spec name must be one path segment")
		assert(type(spec.src) == "string" and spec.src ~= "", "native package spec source is required: " .. spec.name)
		assert(
			spec.version == nil or valid_version(spec.version),
			"native package spec version is invalid: " .. spec.name
		)
		assert(enabled[spec.name] == nil, "duplicate native package spec: " .. spec.name)
		enabled[spec.name] = true
	end

	local disabled = {}
	local disabled_names = {}
	for _, name in ipairs(input.disabled_names) do
		assert(valid_package_name(name), "native disabled package name must be one path segment")
		assert(disabled[name] == nil, "duplicate native disabled package: " .. name)
		assert(enabled[name] == nil, "native package cannot be enabled and disabled: " .. name)
		disabled[name] = true
		table.insert(disabled_names, name)
	end
	table.sort(disabled_names)

	return input.specs, disabled_names
end

local function read_lock_plugins()
	local path = vim.fs.joinpath(vim.fn.stdpath("config"), "nvim-pack-lock.json")
	local stat, stat_error, stat_name = vim.uv.fs_lstat(path)
	if stat == nil then
		assert(stat_name == "ENOENT", ("native package lock stat failed:\n%s"):format(stat_error))
		return {}
	end

	local read, lines = pcall(vim.fn.readfile, path)
	assert(read, ("native package lock read failed:\n%s"):format(lines))
	local decoded, lock = pcall(vim.json.decode, table.concat(lines, "\n"))
	assert(decoded, ("native package lock decode failed:\n%s"):format(lock))
	assert(type(lock) == "table" and type(lock.plugins) == "table", "native package lock is malformed")
	return lock.plugins
end

local function validate_lock_plugins(lock_plugins)
	for name, data in pairs(lock_plugins) do
		assert(valid_package_name(name), "native package lock name must be one path segment")
		assert(type(data) == "table", "native package lock entry must be a table: " .. name)
		assert(type(data.rev) == "string" and data.rev ~= "", "native package lock revision is required: " .. name)
		assert(type(data.src) == "string" and data.src ~= "", "native package lock source is required: " .. name)
		assert(
			data.version == nil or type(data.version) == "string",
			"native package lock version must be a string: " .. name
		)
	end
end

local function preflight(disabled_names, lock_plugins)
	local runtimepath = vim.opt.runtimepath:get()
	for _, name in ipairs(disabled_names) do
		assert(vim.tbl_contains(runtimepath, package_path(name)) == false, "native disabled plugin is active: " .. name)
	end
end

local function prepare(specs, disabled_names, lock_plugins, sentinels)
	for _, spec in ipairs(specs) do
		local path = package_path(spec.name)
		if vim.uv.fs_lstat(marker_path(path)) ~= nil then
			vim.fs.rm(path, { recursive = true, force = true })
		end
	end

	for _, name in ipairs(disabled_names) do
		local path = package_path(name)
		vim.fs.rm(path, { recursive = true, force = true })
		if lock_plugins[name] ~= nil then
			-- Track before creation so cleanup also removes a partially written sentinel.
			table.insert(sentinels, path)
			vim.fn.mkdir(path, "p")
			vim.fn.writefile({}, marker_path(path))
		end
	end
end

local function cleanup(sentinels)
	local first_cause
	for _, path in ipairs(sentinels) do
		local cleaned, cause = xpcall(function()
			vim.fs.rm(path, { recursive = true, force = true })
		end, debug.traceback)
		if cleaned == false and first_cause == nil then
			first_cause = cause
		end
	end
	return first_cause
end

function M.inspect_disabled_packages(disabled_names)
	local _, names = validate_input({ specs = {}, disabled_names = disabled_names })
	local statuses = {}
	for _, name in ipairs(names) do
		local path = package_path(name)
		local stat, stat_error, stat_name = vim.uv.fs_lstat(path)
		assert(stat ~= nil or stat_name == "ENOENT", ("native package stat failed:\n%s"):format(stat_error))
		table.insert(statuses, {
			name = name,
			path = path,
			installed = stat ~= nil,
		})
	end
	return statuses
end

function M.synchronize(input)
	local specs, disabled_names = validate_input(input)
	local lock_plugins = read_lock_plugins()
	validate_lock_plugins(lock_plugins)
	preflight(disabled_names, lock_plugins)

	local sentinels = {}
	local phase = "preparation"
	local completed, cause = xpcall(function()
		prepare(specs, disabled_names, lock_plugins, sentinels)
		phase = "synchronization"
		vim.pack.add(specs, {
			confirm = true,
			load = function() end,
		})
	end, debug.traceback)
	local cleanup_cause = cleanup(sentinels)

	if completed == false then
		local message = ("native package %s failed:\n%s"):format(phase, cause)
		if cleanup_cause ~= nil then
			message = message .. "\nnative disabled package cleanup also failed:\n" .. cleanup_cause
		end
		error(message, 0)
	end
	if cleanup_cause ~= nil then
		error("native disabled package cleanup failed:\n" .. cleanup_cause, 0)
	end
end

return M
