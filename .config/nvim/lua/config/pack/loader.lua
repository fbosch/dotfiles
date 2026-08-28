local registry = require("config.pack.registry")

local M = {}
local states = {}
local failures = {}
local trigger_autocmds = {}
local initialized = {}

local function clear_trigger_autocmds(name)
	for _, id in ipairs(trigger_autocmds[name] or {}) do
		pcall(vim.api.nvim_del_autocmd, id)
	end
	trigger_autocmds[name] = nil
end

local function track_trigger_autocmd(name, id)
	trigger_autocmds[name] = trigger_autocmds[name] or {}
	table.insert(trigger_autocmds[name], id)
end

local function activation_error(root, chain, plugin, phase, cause)
	return table.concat({
		"native activation failed",
		"root: " .. root,
		"chain: " .. table.concat(chain, " -> "),
		"plugin: " .. plugin,
		"phase: " .. phase,
		"cause: " .. tostring(cause),
	}, "\n")
end

local function activate(name, context, root, chain, dependency)
	if states[name] == "loaded" then
		return true
	end

	if states[name] == "failed" then
		error(failures[name], 0)
	end

	local plugin = assert(registry.get(name), "unknown native plugin: " .. name)
	local next_chain = vim.list_extend(vim.deepcopy(chain), { name })
	if states[name] == "loading" then
		error(activation_error(root, next_chain, name, "dependency", "re-entrant activation"), 0)
	end

	if dependency == false and plugin.condition ~= nil then
		local ok, eligible = xpcall(function()
			return plugin.condition(context)
		end, debug.traceback)
		if ok == false or type(eligible) ~= "boolean" then
			local cause = ok and "condition must return a boolean" or eligible
			local message = activation_error(root, next_chain, name, "condition", cause)
			states[name] = "failed"
			failures[name] = message
			clear_trigger_autocmds(name)
			error(message, 0)
		end
		if eligible == false then
			return false, "activation condition not met"
		end
	end

	states[name] = "loading"
	local phase = "dependency"
	local ok, cause = xpcall(function()
		for _, dependency_name in ipairs(plugin.dependencies or {}) do
			activate(dependency_name, context, root, next_chain, true)
		end

		phase = "packadd"
		vim.cmd.packadd(name)

		phase = "setup"
		if plugin.opts ~= nil then
			require(plugin.module or name).setup(plugin.opts)
		elseif plugin.setup ~= nil then
			plugin.setup(context)
		end
	end, debug.traceback)

	if ok == false then
		local message = activation_error(root, next_chain, name, phase, cause)
		states[name] = "failed"
		failures[name] = message
		clear_trigger_autocmds(name)
		error(message, 0)
	end

	states[name] = "loaded"
	clear_trigger_autocmds(name)
	return true
end

function M.activate(name, context)
	return activate(name, context, name, {}, false)
end

local function initialize(name, root, chain)
	if initialized[name] then
		return
	end

	local plugin = assert(registry.get(name), "unknown native plugin: " .. name)
	local next_chain = vim.list_extend(vim.deepcopy(chain), { name })
	for _, dependency_name in ipairs(plugin.dependencies or {}) do
		initialize(dependency_name, root, next_chain)
	end

	if plugin.init ~= nil then
		local ok, cause = xpcall(plugin.init, debug.traceback)
		if ok == false then
			local message = activation_error(root, next_chain, name, "init", cause)
			states[name] = "failed"
			failures[name] = message
			error(message, 0)
		end
	end

	initialized[name] = true
end

local function validate_dependencies()
	for name, plugin in pairs(registry.all()) do
		for _, dependency in ipairs(plugin.dependencies or {}) do
			assert(registry.get(dependency) ~= nil, "unknown native dependency: " .. name .. " -> " .. dependency)
		end
	end

	local visiting = {}
	local visited = {}
	local function visit(name, chain)
		if visiting[name] then
			error("native dependency cycle: " .. table.concat(vim.list_extend(chain, { name }), " -> "))
		end
		if visited[name] then
			return
		end

		visiting[name] = true
		local next_chain = vim.list_extend(vim.deepcopy(chain), { name })
		for _, dependency in ipairs(registry.get(name).dependencies or {}) do
			visit(dependency, next_chain)
		end
		visiting[name] = nil
		visited[name] = true
	end

	for name in pairs(registry.all()) do
		visit(name, {})
	end
end

local function validate_key_triggers()
	local owners = {}
	for name, plugin in pairs(registry.all()) do
		for _, key in ipairs(plugin.keys or {}) do
			local modes = type(key.mode) == "table" and key.mode or { key.mode or "n" }
			for _, mode in ipairs(modes) do
				local id = mode .. "\0" .. vim.keycode(key[1])
				assert(owners[id] == nil, ("duplicate native key: %s and %s -> %s"):format(owners[id], name, key[1]))
				owners[id] = name

				local existing = vim.fn.maparg(key[1], mode, false, true)
				assert(
					next(existing) == nil or key.replace == true,
					("native key conflicts with existing mapping: %s -> %s (%s)"):format(name, key[1], mode)
				)
			end
		end
	end
end

local function register_autocmd_triggers(name, plugin)
	for _, filetype in ipairs(plugin.filetypes or {}) do
		local id = vim.api.nvim_create_autocmd("FileType", {
			pattern = filetype,
			callback = function(event)
				if states[name] == "loading" then
					return
				end
				M.activate(name, event)
			end,
		})
		track_trigger_autocmd(name, id)
	end

	for _, event in ipairs(plugin.events or {}) do
		local event_name = type(event) == "table" and event[1] or event
		local id = vim.api.nvim_create_autocmd(event_name, {
			pattern = type(event) == "table" and event.pattern or nil,
			callback = function(event_context)
				if states[name] == "loading" then
					return
				end
				M.activate(name, event_context)
			end,
		})
		track_trigger_autocmd(name, id)
	end

	for _, command in ipairs(plugin.commands or {}) do
		vim.api.nvim_create_autocmd("CmdUndefined", {
			pattern = command,
			callback = function(event)
				local activated, reason = M.activate(name, event)
				if activated == false then
					vim.notify(("%s is unavailable: %s"):format(name, reason), vim.log.levels.WARN)
				end
			end,
		})
	end
end

local function register_key_triggers(name, plugin)
	for _, key in ipairs(plugin.keys or {}) do
		local callback
		if key.expr then
			callback = function()
				local activated = M.activate(name, {
					buf = vim.api.nvim_get_current_buf(),
					mode = vim.fn.mode(1),
					source = "key",
				})
				if activated == false then
					return ""
				end
				return key[2]()
			end
		else
			callback = function()
				local activated, reason = M.activate(name, {
					buf = vim.api.nvim_get_current_buf(),
					mode = vim.fn.mode(1),
					source = "key",
				})
				if activated == false then
					vim.notify(("%s is unavailable: %s"):format(name, reason), vim.log.levels.WARN)
					return
				end
				key[2]()
			end
		end

		vim.keymap.set(key.mode or "n", key[1], callback, {
			desc = key.desc,
			expr = key.expr == true,
			silent = key.silent,
		})
	end
end

function M.setup()
	validate_dependencies()
	validate_key_triggers()

	local plugin_names = vim.tbl_keys(registry.all())
	table.sort(plugin_names)
	for _, name in ipairs(plugin_names) do
		initialize(name, name, {})
	end

	for name, plugin in pairs(registry.all()) do
		register_autocmd_triggers(name, plugin)
		register_key_triggers(name, plugin)
	end

	local startup_plugins = {}
	for name, plugin in pairs(registry.all()) do
		if plugin.startup == true then
			table.insert(startup_plugins, name)
		end
	end
	table.sort(startup_plugins)
	for _, name in ipairs(startup_plugins) do
		M.activate(name, { source = "startup" })
	end

	vim.api.nvim_create_autocmd("VimEnter", {
		once = true,
		callback = function()
			vim.schedule(function()
				vim.api.nvim_exec_autocmds("User", { pattern = "PackReady" })
			end)
		end,
	})
end

function M.is_loaded(name)
	return states[name] == "loaded"
end

return M
