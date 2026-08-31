local repo_root = assert(vim.env.REPO_ROOT)
local loader_path = repo_root .. "/.config/nvim/lua/config/pack/loader.lua"

local host
local autocmd_id = 0
local original = {
	cmd = vim.cmd,
	create_autocmd = vim.api.nvim_create_autocmd,
	del_autocmd = vim.api.nvim_del_autocmd,
	exec_autocmds = vim.api.nvim_exec_autocmds,
	get_current_buf = vim.api.nvim_get_current_buf,
	keycode = vim.keycode,
	maparg = vim.fn.maparg,
	mode = vim.fn.mode,
	notify = vim.notify,
	schedule = vim.schedule,
	keymap_set = vim.keymap.set,
}

local function reset_host()
	host = {
		autocmds = {},
		executed_autocmds = {},
		keymaps = {},
		notifications = {},
		scheduled = {},
		packadd = function() end,
	}
end

vim.cmd = {
	packadd = function(name)
		return host.packadd(name)
	end,
}
vim.api.nvim_create_autocmd = function(event, opts)
	autocmd_id = autocmd_id + 1
	host.autocmds[autocmd_id] = { event = event, opts = opts }
	return autocmd_id
end
vim.api.nvim_del_autocmd = function(id)
	host.autocmds[id] = nil
end
vim.api.nvim_exec_autocmds = function(event, opts)
	table.insert(host.executed_autocmds, { event = event, opts = opts })
end
vim.api.nvim_get_current_buf = function()
	return 1
end
vim.keycode = function(value)
	return value
end
vim.fn.maparg = function()
	return {}
end
vim.fn.mode = function()
	return "n"
end
vim.notify = function(message, level)
	table.insert(host.notifications, { message = message, level = level })
end
vim.schedule = function(callback)
	table.insert(host.scheduled, callback)
end
vim.keymap.set = function(mode, lhs, callback, opts)
	table.insert(host.keymaps, { mode = mode, lhs = lhs, callback = callback, opts = opts })
end

local function load_loader(plugins)
	local names = vim.tbl_keys(plugins)
	table.sort(names)
	local inventory = {
		enabled_by_name = plugins,
		enabled_names = names,
	}
	return dofile(loader_path), inventory
end

do
	reset_host()
	local order = {}
	local context = { source = "test" }
	local loader, inventory = load_loader({
		["a-root.nvim"] = {
			dependencies = { "z-dependency.nvim" },
			init = function()
				table.insert(order, "init:root")
			end,
			setup = function(received)
				assert(received == context, "root setup received the wrong activation context")
				table.insert(order, "setup:root")
			end,
		},
		["z-dependency.nvim"] = {
			root = false,
			init = function()
				table.insert(order, "init:dependency")
			end,
			setup = function(received)
				assert(received == context, "dependency setup received the wrong activation context")
				table.insert(order, "setup:dependency")
			end,
		},
	})
	host.packadd = function(name)
		table.insert(order, "packadd:" .. name)
	end

	loader.setup(inventory)
	assert(vim.deep_equal(order, { "init:dependency", "init:root" }), "dependencies were not initialized first")
	assert(loader.activate("a-root.nvim", context) == true, "root activation did not succeed")
	assert(
		vim.deep_equal(order, {
			"init:dependency",
			"init:root",
			"packadd:z-dependency.nvim",
			"setup:dependency",
			"packadd:a-root.nvim",
			"setup:root",
		}),
		"dependencies were not activated before the root"
	)
	assert(loader.is_loaded("a-root.nvim"), "root was not marked loaded")
	assert(loader.is_loaded("z-dependency.nvim"), "dependency was not marked loaded")
	assert(loader.activate("a-root.nvim", context) == true, "loaded root activation was not idempotent")
	assert(#order == 6, "loaded root activation repeated lifecycle work")
end

do
	reset_host()
	local condition_calls = 0
	local packadd_calls = 0
	local setup_calls = 0
	local loader, inventory = load_loader({
		["conditional.nvim"] = {
			condition = function(context)
				condition_calls = condition_calls + 1
				return context.ready
			end,
			setup = function(context)
				assert(context.ready == true, "conditional setup received an ineligible context")
				setup_calls = setup_calls + 1
			end,
		},
	})
	host.packadd = function()
		packadd_calls = packadd_calls + 1
	end
	loader.setup(inventory)

	local activated, reason = loader.activate("conditional.nvim", { ready = false })
	assert(activated == false and reason == "activation condition not met", "false condition was not retryable")
	assert(loader.is_loaded("conditional.nvim") == false, "false condition marked the plugin loaded")
	assert(packadd_calls == 0, "false condition added the package before eligibility")
	assert(loader.activate("conditional.nvim", { ready = true }) == true, "eligible retry did not activate")
	assert(condition_calls == 2, "retryable condition was not evaluated for each root request")
	assert(packadd_calls == 1, "eligible retry did not add the package exactly once")
	assert(setup_calls == 1, "conditional setup did not run exactly once")
end

for _, failure in ipairs({
	{ phase = "condition", cause = "condition exploded" },
	{ phase = "packadd", cause = "packadd exploded" },
	{ phase = "setup", cause = "setup exploded" },
}) do
	reset_host()
	local attempts = 0
	local name = "failing-" .. failure.phase .. ".nvim"
	local plugin = {}
	if failure.phase == "condition" then
		plugin.condition = function()
			attempts = attempts + 1
			error(failure.cause)
		end
	elseif failure.phase == "setup" then
		plugin.setup = function()
			attempts = attempts + 1
			error(failure.cause)
		end
	end
	local loader, inventory = load_loader({
		[name] = plugin,
	})
	host.packadd = function()
		if failure.phase == "packadd" then
			attempts = attempts + 1
			error(failure.cause)
		end
	end
	loader.setup(inventory)

	local first_ok, first_error = pcall(loader.activate, name, { source = "first" })
	local second_ok, second_error = pcall(loader.activate, name, { source = "second" })
	assert(first_ok == false and second_ok == false, "activation failure was not sticky")
	assert(first_error == second_error, "sticky activation failure changed between requests")
	for _, fragment in ipairs({
		"root: " .. name,
		"chain: " .. name,
		"plugin: " .. name,
		"phase: " .. failure.phase,
		failure.cause,
	}) do
		assert(tostring(first_error):find(fragment, 1, true) ~= nil, "activation failure omitted: " .. fragment)
	end
	assert(loader.is_loaded(name) == false, "failed plugin was marked loaded")
	assert(attempts == 1, "sticky failure repeated phase work: " .. failure.phase)
end

do
	reset_host()
	local dependency_attempts = 0
	local loader, inventory = load_loader({
		["dependency-root.nvim"] = { dependencies = { "failing-dependency.nvim" } },
		["failing-dependency.nvim"] = {
			root = false,
			setup = function()
				dependency_attempts = dependency_attempts + 1
				error("dependency exploded")
			end,
		},
	})
	loader.setup(inventory)

	local first_ok, first_error = pcall(loader.activate, "dependency-root.nvim", { source = "first" })
	local second_ok, second_error = pcall(loader.activate, "dependency-root.nvim", { source = "second" })
	assert(first_ok == false and second_ok == false, "dependency failure was not sticky at the root")
	assert(first_error == second_error, "sticky dependency failure changed between root requests")
	assert(tostring(first_error):find("phase: dependency", 1, true) ~= nil, "root failure omitted dependency phase")
	assert(tostring(first_error):find("dependency exploded", 1, true) ~= nil, "root failure omitted dependency cause")
	assert(loader.is_loaded("dependency-root.nvim") == false, "failed dependency root was marked loaded")
	assert(loader.is_loaded("failing-dependency.nvim") == false, "failed dependency was marked loaded")
	assert(dependency_attempts == 1, "sticky dependency failure repeated dependency setup")
end

do
	reset_host()
	local loader, inventory = load_loader({
		["unknown-dependency.nvim"] = { dependencies = { "missing.nvim" } },
	})
	local ok, err = pcall(loader.setup, inventory)
	assert(ok == false, "unknown dependency was accepted")
	assert(
		tostring(err):find("unknown native dependency: unknown-dependency.nvim -> missing.nvim", 1, true) ~= nil,
		"unexpected unknown dependency error: " .. tostring(err)
	)
end

do
	reset_host()
	local loader, inventory = load_loader({
		["cycle-a.nvim"] = { dependencies = { "cycle-b.nvim" } },
		["cycle-b.nvim"] = { dependencies = { "cycle-a.nvim" } },
	})
	local ok, err = pcall(loader.setup, inventory)
	assert(ok == false, "dependency cycle was accepted")
	assert(tostring(err):find("native dependency cycle:", 1, true) ~= nil, "unexpected dependency cycle error")
	assert(tostring(err):find("cycle-a.nvim", 1, true) ~= nil, "dependency cycle omitted cycle-a.nvim")
	assert(tostring(err):find("cycle-b.nvim", 1, true) ~= nil, "dependency cycle omitted cycle-b.nvim")
end

do
	reset_host()
	local loader, inventory = load_loader({})
	loader.setup(inventory)

	local vim_enter
	for _, autocmd in pairs(host.autocmds) do
		if autocmd.event == "VimEnter" then
			vim_enter = autocmd
			break
		end
	end
	assert(vim_enter ~= nil and vim_enter.opts.once == true, "loader did not install one-shot VimEnter readiness")
	vim_enter.opts.callback()
	assert(#host.scheduled == 1, "VimEnter did not schedule PackReady publication")
	assert(#host.executed_autocmds == 0, "PackReady published before the scheduled callback")
	host.scheduled[1]()
	assert(#host.executed_autocmds == 1, "scheduled callback did not publish PackReady")
	assert(host.executed_autocmds[1].event == "User", "readiness published the wrong event")
	assert(host.executed_autocmds[1].opts.pattern == "PackReady", "readiness published the wrong pattern")
end

vim.cmd = original.cmd
vim.api.nvim_create_autocmd = original.create_autocmd
vim.api.nvim_del_autocmd = original.del_autocmd
vim.api.nvim_exec_autocmds = original.exec_autocmds
vim.api.nvim_get_current_buf = original.get_current_buf
vim.keycode = original.keycode
vim.fn.maparg = original.maparg
vim.fn.mode = original.mode
vim.notify = original.notify
vim.schedule = original.schedule
vim.keymap.set = original.keymap_set
