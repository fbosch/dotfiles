local repo_root = assert(vim.env.REPO_ROOT)
vim.opt.runtimepath:prepend(repo_root .. "/.config/nvim")

local original_cwd = vim.fn.getcwd()
local test_root = vim.fn.tempname()
local project_a = test_root .. "/project's space"
local project_b = test_root .. "/project-b"
local plain = test_root .. "/plain"
for _, path in ipairs({ project_a .. "/nested", project_b, plain }) do
	vim.fn.mkdir(path, "p")
end
vim.fn.writefile({ "tasks: {}" }, project_a .. "/dekit.yaml")
vim.fn.writefile({ "# fixture; never executed" }, project_a .. "/.envrc")
vim.fn.writefile({ "{}" }, project_b .. "/package.json")

local task_path = "pi/package/" .. string.rep("a", 24)
local dev = {
	name = "package:dev",
	script = "package:dev",
	requiredParameters = {},
	task = { id = 42, path = task_path, state = "ready" },
}
local build = { name = "just:build", script = "just:build", requiredParameters = { "target" } }
local state = {
	entries = { dev, build },
	choices = {},
	calls = {},
	selections = {},
	inputs = {},
	notifications = {},
	pending = {},
}
local original_system = vim.system
local original_select = vim.ui.select
local original_input = vim.ui.input
local original_notify = vim.notify

vim.system = function(command, options, callback)
	local request = vim.json.decode(options.stdin)
	table.insert(state.calls, { command = command, options = options, request = request })
	local response = {
		project = vim.uv.fs_realpath(options.cwd),
		entries = request.action == "list" and state.entries or nil,
		task = request.action ~= "list" and (request.task or task_path) or nil,
	}
	local result = {
		code = state.fail and 1 or 0,
		stderr = state.fail or "",
		stdout = state.malformed and "not JSON" or vim.json.encode(response),
	}
	if state.delay then
		table.insert(state.pending, function()
			callback(result)
		end)
	else
		callback(result)
	end
	return {}
end

vim.ui.select = function(items, opts, callback)
	local labels = {}
	for _, item in ipairs(items) do
		table.insert(labels, opts.format_item(item))
	end
	table.insert(state.selections, { labels = labels, prompt = opts.prompt })
	local choice = table.remove(state.choices, 1)
	if not choice then
		callback(nil)
		return
	end
	for _, item in ipairs(items) do
		if item.name == choice then
			callback(item)
			return
		end
	end
	error("Missing picker choice: " .. choice)
end
vim.ui.input = function(opts, callback)
	table.insert(state.inputs, opts.prompt)
	callback(state.input)
end
vim.notify = function(message)
	table.insert(state.notifications, message)
end

local instances = {}
package.loaded.FTerm = {
	new = function(_, opts)
		local instance = { opts = opts, opens = 0, closes = {} }
		function instance:open()
			self.opens = self.opens + 1
		end
		function instance:close(force)
			table.insert(self.closes, { force = force })
		end
		table.insert(instances, instance)
		return instance
	end,
}

local function equal(actual, expected, message)
	assert(vim.deep_equal(actual, expected), message .. ": " .. vim.inspect(actual))
end

local function wait_for(predicate, message)
	assert(vim.wait(1000, predicate, 5), message)
end

local function pick(choices, predicate)
	state.choices = choices
	vim.cmd.FTermDekit()
	wait_for(predicate, "picker did not complete")
end

local ok, err = xpcall(function()
	local spec = require("plugins.workflow.terminal")[1]
	spec.init()
	for _, mode in ipairs({ "n", "t" }) do
		local mapping = vim.fn.maparg("<A-m>", mode, false, true)
		assert(mapping.rhs:find("FTermDekit", 1, true), "Alt-m opens picker in " .. mode)
	end
	spec.setup()
	equal(vim.fn.exists(":FTermDekit"), 2, "dekit command registered")

	local project = require("utils.project")
	vim.api.nvim_set_current_dir(project_a .. "/nested")
	equal(project.get_project_root(), project_a, "nested cwd finds project")
	pick({ "Open task console" }, function()
		return #instances == 2
	end)
	local first = instances[#instances]
	local escaped = vim.fn.shellescape(project_a)
	equal(
		first.opts.cmd,
		"cd " .. escaped .. " && direnv exec " .. escaped .. " dekit -C " .. escaped .. " attach",
		"shared console uses explicit root and escaped direnv"
	)
	equal(first.opts.ft, "fterm_dekit", "terminal filetype")
	equal(first.opts.env.IN_NEOVIM, "1", "terminal environment")
	equal(first.opts.shell, "dash", "command shell")
	equal(first.opts.dimensions, { height = 0.85, width = 0.85 }, "terminal dimensions")
	equal(state.calls[1].command, {
		"direnv",
		"exec",
		project_a,
		"bun",
		vim.fn.expand("~/.pi/agent/extensions/dekit/project-cli.ts"),
		project_a,
	}, "catalog discovery also uses the project environment")
	equal(state.calls[1].request, { action = "list" }, "opens with read-only snapshot")
	equal(state.selections[1].labels, {
		"Open task console",
		"package:dev [running]",
		"just:build [not started]",
		"Refresh",
	}, "running agent task is merged with available scripts")

	local count = #instances
	pick({ "Open task console" }, function()
		return first.opens == 2
	end)
	equal(#instances, count, "same project and target reuse attachment")

	pick({ "package:dev", "Restart" }, function()
		return #instances == count + 1
	end)
	local restarted = instances[#instances]
	equal(state.calls[#state.calls].request, {
		action = "restart",
		task = task_path,
		id = 42,
	}, "restart targets the existing agent task")
	equal(
		restarted.opts.cmd,
		"cd "
			.. escaped
			.. " && direnv exec "
			.. escaped
			.. " dekit -C "
			.. escaped
			.. " attach --no-start -- "
			.. vim.fn.shellescape(task_path),
		"view attaches to the exact shared task"
	)
	equal(first.closes[#first.closes].force, true, "changing attachment exits the old client")

	state.input = '"a b" --watch'
	local calls_before = #state.calls
	pick({ "package:dev", "Start with arguments…" }, function()
		return #state.calls == calls_before + 2 and #state.choices == 0
	end)
	equal(state.calls[#state.calls].request, {
		action = "start",
		script = "package:dev",
		input = state.input,
	}, "argument text reaches shared parser unchanged")

	state.input = nil
	calls_before = #state.calls
	local inputs_before = #state.inputs
	pick({ "just:build", "Start" }, function()
		return #state.inputs == inputs_before + 1
	end)
	assert(state.inputs[#state.inputs]:find("target", 1, true), "required parameters shown")
	equal(#state.calls, calls_before + 1, "cancelled arguments do not start a task")

	local selections_before = #state.selections
	pick({ "Refresh" }, function()
		return #state.selections == selections_before + 2
	end)
	equal(state.calls[#state.calls].request, { action = "list" }, "refresh rereads shared state")

	calls_before = #state.calls
	pick({ "package:dev", "Stop" }, function()
		return #state.calls == calls_before + 3
	end)
	equal(state.calls[calls_before + 2].request.action, "stop", "stop uses shared runner")
	equal(state.calls[calls_before + 3].request.action, "list", "stop refreshes picker")

	vim.api.nvim_set_current_dir(project_b)
	count = #instances
	pick({ "Open task console" }, function()
		return #instances == count + 1
	end)
	local second = instances[#instances]
	escaped = vim.fn.shellescape(project_b)
	equal(second.opts.cmd, "cd " .. escaped .. " && dekit -C " .. escaped .. " attach", "package project shares runner")

	vim.fn.writefile({ "test:", "\t@echo fixture" }, project_b .. "/justfile")
	equal(project.resolve_dekit_command(project_b), "dekit -C " .. escaped .. " attach", "Just project shares runner")

	vim.api.nvim_set_current_dir(plain)
	count = #instances
	pick({ "Open task console" }, function()
		return #instances == count + 1
	end)
	escaped = vim.fn.shellescape(plain)
	equal(instances[#instances].opts.cmd, "cd " .. escaped .. " && dekit -C " .. escaped .. " attach", "cwd fallback")

	state.fail = "runner fixture failure"
	local notifications_before = #state.notifications
	pick({}, function()
		return #state.notifications == notifications_before + 1
	end)
	assert(state.notifications[#state.notifications]:find(state.fail, 1, true), "CLI failure reported")
	state.fail = nil
	state.malformed = true
	notifications_before = #state.notifications
	pick({}, function()
		return #state.notifications == notifications_before + 1
	end)
	equal(state.notifications[#state.notifications], "Dekit returned an invalid response", "invalid JSON reported")
	state.malformed = nil

	state.delay = true
	selections_before = #state.selections
	vim.cmd.FTermDekit()
	vim.cmd.FTermDekit()
	equal(#state.pending, 2, "two pending picker requests")
	state.pending[2]()
	state.pending[1]()
	wait_for(function()
		return #state.selections == selections_before + 1
	end, "latest picker response shown")
	vim.wait(20)
	equal(#state.selections, selections_before + 1, "stale response ignored")
end, debug.traceback)

vim.system = original_system
vim.ui.select = original_select
vim.ui.input = original_input
vim.notify = original_notify
vim.api.nvim_set_current_dir(original_cwd)
vim.fn.delete(test_root, "rf")
if not ok then
	error(err)
end
print("dekit terminal tests passed")
vim.cmd.qa()
