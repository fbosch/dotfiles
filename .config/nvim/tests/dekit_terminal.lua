local repo_root = assert(vim.env.REPO_ROOT)
vim.opt.runtimepath:prepend(repo_root .. "/.config/nvim")

local original_cwd = vim.fn.getcwd()
local original_system = vim.system
local environment_names = { "DIRENV_DIR", "DIRENV_FILE", "IN_NIX_SHELL" }
local original_environment = {}
for _, name in ipairs(environment_names) do
	original_environment[name] = vim.env[name]
	vim.env[name] = nil
end
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

local instances = {}
local next_job = 0
package.loaded.FTerm = {
	new = function(_, opts)
		local instance = { opts = opts, opens = 0, closes = {} }
		function instance:open()
			if self.terminal == nil then
				next_job = next_job + 1
				self.terminal = next_job
			end
			self.opens = self.opens + 1
			self.win = vim.api.nvim_get_current_win()
		end
		function instance:close(force)
			table.insert(self.closes, { force = force })
			self.win = nil
			if force then
				self.terminal = nil
			end
		end
		function instance:toggle()
			if self.win and vim.api.nvim_win_is_valid(self.win) then
				self:close()
			else
				self:open()
			end
		end
		table.insert(instances, instance)
		return instance
	end,
}

local function equal(actual, expected, message)
	assert(vim.deep_equal(actual, expected), message .. ": " .. vim.inspect(actual))
end

local function native_command(root)
	local importer = vim.fn.shellescape(vim.fn.expand("~/.pi/agent/extensions/dekit/import-scripts.ts"))
	local escaped = vim.fn.shellescape(root)
	return "bun " .. importer .. " " .. escaped .. " && exec dekit -C " .. escaped .. " attach"
end

local function direnv_command(root)
	return "direnv exec " .. vim.fn.shellescape(root) .. " dash -c " .. vim.fn.shellescape(native_command(root))
end

local ok, err = xpcall(function()
	local spec = require("plugins.workflow.terminal")[1]
	equal(vim.tbl_contains(spec.commands, "FTermDekit"), true, "native console lazy command")
	spec.init()
	for _, mode in ipairs({ "n", "t" }) do
		local mapping = vim.fn.maparg("<A-m>", mode, false, true)
		assert(mapping.rhs:find("FTermDekit", 1, true), "Alt-m opens native console in " .. mode)
	end
	spec.setup()

	local project = require("utils.project")
	vim.api.nvim_set_current_dir(project_a .. "/nested")
	equal(project.get_project_root(), project_a, "nested cwd finds project root")
	vim.cmd.FTermDekit()
	local first = instances[#instances]
	local escaped = vim.fn.shellescape(project_a)
	local expected = "cd " .. escaped .. " && " .. direnv_command(project_a)
	equal(first.opts.cmd, expected, "direnv covers import and native UI with safe quoting")
	equal(first.opts.ft, "fterm_dekit", "terminal filetype")
	equal(first.opts.env.IN_NEOVIM, "1", "terminal environment")
	equal(first.opts.shell, "dash", "command shell")
	equal(first.opts.dimensions, { height = 0.85, width = 0.85 }, "terminal dimensions")
	equal(first.opens, 1, "native console opened directly")
	local first_job = first.terminal

	local count = #instances
	vim.cmd.FTermDekit()
	equal(#instances, count, "visible console closes without another client")
	equal(first.win, nil, "console window hidden")
	vim.cmd.FTermDekit()
	equal(#instances, count, "reopening reuses the background console")
	local refreshed = instances[#instances]
	equal(refreshed.opens, 2, "same console window reopened")
	equal(refreshed.terminal, first_job, "background terminal job survives hiding and reopening")
	equal(refreshed.opts.cmd, expected, "reopening keeps the original project environment")
	vim.api.nvim_set_current_dir(project_b)
	vim.cmd.FTermDekit()
	equal(refreshed.closes[#refreshed.closes].force, true, "project switch exits old attachment")
	local second = instances[#instances]
	escaped = vim.fn.shellescape(project_b)
	equal(
		second.opts.cmd,
		"cd " .. escaped .. " && " .. native_command(project_b),
		"package project imports scripts before native attachment"
	)

	local second_job = second.terminal
	local project_b_instances = #instances
	first.opts.on_exit(first_job, 1)
	vim.cmd.FTermDekit()
	vim.cmd.FTermDekit()
	equal(#instances, project_b_instances, "an old client's exit cannot invalidate the current project")
	equal(second.terminal, second_job, "current project's background job survives a late exit callback")

	for _, name in ipairs({ "justfile", "Justfile", ".justfile" }) do
		vim.fn.writefile({ "test:", "\t@echo fixture" }, project_b .. "/" .. name)
		equal(project.resolve_dekit_command(project_b), native_command(project_b), name .. " uses shared import")
		vim.fn.delete(project_b .. "/" .. name)
	end

	local devenv_project = test_root .. "/devenv-only"
	vim.fn.mkdir(devenv_project .. "/nested", "p")
	vim.fn.writefile({ "# fixture" }, devenv_project .. "/devenv.nix")
	vim.api.nvim_set_current_dir(devenv_project .. "/nested")
	equal(project.get_project_root(), devenv_project, "nested cwd finds standalone devenv project")
	vim.cmd.FTermDekit()
	equal(
		instances[#instances].opts.cmd,
		"cd " .. vim.fn.shellescape(devenv_project) .. " && " .. native_command(devenv_project),
		"standalone devenv project uses the shared catalog importer"
	)

	vim.api.nvim_set_current_dir(plain)
	equal(project.get_project_root(), nil, "unmarked directory")
	vim.cmd.FTermDekit()
	local third = instances[#instances]
	escaped = vim.fn.shellescape(plain)
	equal(third.opts.cmd, "cd " .. escaped .. " && " .. native_command(plain), "cwd fallback")
	vim.api.nvim_set_current_dir(test_root)
	vim.cmd.FTermDekit()
	equal(third.closes[#third.closes].force, true, "fallback root switch exits old attachment")
	equal(
		instances[#instances].opts.cmd,
		"cd " .. vim.fn.shellescape(test_root) .. " && " .. native_command(test_root),
		"new fallback runner"
	)

	local status_calls = 0
	local allowed = 0
	local status_code = 0
	local status_output
	local loaded_path = project_a .. "/.envrc"
	vim.system = function(command, options)
		equal(command, { "direnv", "status", "--json" }, "direnv detection only reads status")
		equal(options.cwd, project_a, "direnv status uses the requested project")
		status_calls = status_calls + 1
		return {
			wait = function(_, timeout)
				assert(timeout > 0 and timeout <= 1000, "direnv status lookup is bounded")
				return {
					code = status_code,
					stdout = status_output or vim.json.encode({
						state = {
							loadedRC = { path = loaded_path, allowed = allowed },
							foundRC = { path = project_a .. "/.envrc", allowed = allowed },
						},
					}),
				}
			end,
		}
	end
	vim.env.DIRENV_DIR = "-" .. project_a
	vim.env.DIRENV_FILE = project_a .. "/.envrc"
	vim.api.nvim_set_current_dir(project_a)
	vim.cmd.FTermDekit()
	local inherited = instances[#instances]
	equal(
		inherited.opts.cmd,
		"cd " .. vim.fn.shellescape(project_a) .. " && " .. native_command(project_a),
		"a matching inherited direnv environment launches the native console directly"
	)
	equal(status_calls, 1, "fresh console checks direnv approval once")
	local inherited_job = inherited.terminal
	vim.cmd.FTermDekit()
	vim.env.DIRENV_DIR = "-" .. project_b
	vim.cmd.FTermDekit()
	equal(instances[#instances].terminal, inherited_job, "hidden console retains its loaded environment")
	equal(status_calls, 1, "reopening a live client does not probe or re-enter direnv")

	inherited.opts.on_exit(inherited_job, 1)
	vim.cmd.FTermDekit()
	local recovered = instances[#instances]
	assert(recovered ~= inherited, "an exited console gets a fresh client")
	equal(recovered.opts.cmd, expected, "a fresh client loads the correct project's environment")

	vim.env.DIRENV_DIR = "-" .. project_a
	local finished_job = recovered.terminal
	-- FTerm clears the job before its successful-exit callback.
	recovered:close(true)
	recovered.opts.on_exit(finished_job, 0)
	vim.cmd.FTermDekit()
	local after_exit = instances[#instances]
	assert(after_exit ~= recovered, "a cleanly exited client rechecks the current environment")
	equal(
		after_exit.opts.cmd,
		"cd " .. vim.fn.shellescape(project_a) .. " && " .. native_command(project_a),
		"successful-exit recovery uses the newly inherited environment"
	)

	vim.env.DIRENV_DIR = "-" .. project_a
	allowed = 1
	equal(project.resolve_dekit_command(project_a), direnv_command(project_a), "unapproved metadata still uses direnv")
	allowed = 0
	loaded_path = project_b .. "/.envrc"
	assert(
		project.resolve_dekit_command(project_a):find("direnv exec", 1, true),
		"another loaded RC cannot supply this project's environment"
	)
	loaded_path = project_a .. "/.envrc"
	status_output = "invalid json"
	assert(
		project.resolve_dekit_command(project_a):find("direnv exec", 1, true),
		"malformed status cannot authorize environment reuse"
	)
	status_output = nil
	status_code = 1
	assert(
		project.resolve_dekit_command(project_a):find("direnv exec", 1, true),
		"failed status cannot authorize environment reuse"
	)
	status_code = 0
	vim.env.DIRENV_DIR = nil
	vim.env.IN_NIX_SHELL = "pure"
	assert(
		project.resolve_dekit_command(project_a):find("direnv exec", 1, true),
		"a generic Nix shell does not identify the project's direnv environment"
	)

	local alias = test_root .. "/project-a-link"
	assert(vim.uv.fs_symlink(project_a, alias))
	vim.env.DIRENV_DIR = "-" .. alias
	equal(
		project.resolve_dekit_command(project_a),
		native_command(project_a),
		"symlink aliases identify the same active project"
	)
end, debug.traceback)

vim.system = original_system
for _, name in ipairs(environment_names) do
	vim.env[name] = original_environment[name]
end
vim.api.nvim_set_current_dir(original_cwd)
vim.fn.delete(test_root, "rf")
if not ok then
	error(err)
end
print("native dekit import terminal tests passed")
vim.cmd.qa()
