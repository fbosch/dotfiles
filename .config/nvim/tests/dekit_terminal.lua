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

local instances = {}
package.loaded.FTerm = {
	new = function(_, opts)
		local instance = { opts = opts, toggles = 0, closes = {} }
		function instance:toggle()
			self.toggles = self.toggles + 1
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

local ok, err = xpcall(function()
	local spec = require("plugins.workflow.terminal")[1]
	equal(vim.tbl_contains(spec.commands, "FTermDekit"), true, "dekit lazy command")
	equal(vim.tbl_contains(spec.commands, "FTermMProcs"), false, "legacy command removed")
	spec.init()
	for _, mode in ipairs({ "n", "t" }) do
		local mapping = vim.fn.maparg("<A-m>", mode, false, true)
		assert(mapping.rhs:find("FTermDekit", 1, true), "Alt-m maps to dekit in " .. mode)
	end
	spec.setup()
	equal(vim.fn.exists(":FTermDekit"), 2, "dekit command registered")
	equal(vim.fn.exists(":FTermMProcs"), 0, "legacy command not registered")

	local project = require("utils.project")
	equal(project.resolve_mprocs_args, nil, "legacy discovery removed")
	vim.api.nvim_set_current_dir(project_a .. "/nested")
	equal(project.get_project_root(), project_a, "standalone dekit root from nested cwd")
	vim.cmd.FTermDekit()
	local first = instances[#instances]
	local escaped = vim.fn.shellescape(project_a)
	equal(
		first.opts.cmd,
		"cd " .. escaped .. " && direnv exec " .. escaped .. " dekit -C " .. escaped .. " attach",
		"explicit root and direnv shell escaping"
	)
	equal(first.opts.ft, "fterm_dekit", "terminal filetype")
	equal(first.opts.env.IN_NEOVIM, "1", "terminal environment")
	equal(first.opts.shell, "dash", "command shell")
	equal(first.opts.dimensions, { height = 0.85, width = 0.85 }, "terminal dimensions")

	local count = #instances
	vim.cmd.FTermDekit()
	equal(#instances, count, "same project reuses terminal")
	equal(first.toggles, 2, "same instance toggled")

	vim.api.nvim_set_current_dir(project_b)
	vim.cmd.FTermDekit()
	equal(first.closes[#first.closes].force, true, "project switch exits old attachment")
	local second = instances[#instances]
	escaped = vim.fn.shellescape(project_b)
	equal(second.opts.cmd, "cd " .. escaped .. " && dekit mprocs --npm", "package scripts listed")

	vim.fn.writefile({ "test:", "\t@echo fixture" }, project_b .. "/justfile")
	vim.cmd.FTermDekit()
	escaped = vim.fn.shellescape(project_b)
	equal(instances[#instances].opts.cmd, "cd " .. escaped .. " && dekit mprocs --just", "Just recipes listed")

	for _, name in ipairs({ "Justfile", ".justfile" }) do
		vim.fn.delete(project_b .. "/justfile")
		vim.fn.writefile({ "test:", "\t@echo fixture" }, project_b .. "/" .. name)
		equal(project.resolve_dekit_command(project_b), "dekit mprocs --just", name .. " detected")
		vim.fn.delete(project_b .. "/" .. name)
	end
	vim.fn.writefile({ "procs: {}" }, project_a .. "/mprocs.yml")
	vim.fn.writefile({ "test:", "\t@echo fixture" }, project_a .. "/justfile")
	equal(
		project.resolve_dekit_command(project_a),
		"dekit mprocs --config " .. vim.fn.shellescape(project_a .. "/mprocs.yml") .. " --just",
		"existing mprocs config combined with recipes"
	)
	vim.fn.delete(project_a .. "/justfile")
	equal(
		project.resolve_dekit_command(project_a),
		"dekit mprocs --config " .. vim.fn.shellescape(project_a .. "/mprocs.yml"),
		"existing mprocs config alone"
	)

	vim.api.nvim_set_current_dir(plain)
	equal(project.get_project_root(), nil, "unmarked directory")
	vim.cmd.FTermDekit()
	local third = instances[#instances]
	escaped = vim.fn.shellescape(plain)
	equal(third.opts.cmd, "cd " .. escaped .. " && dekit -C " .. escaped .. " attach", "cwd fallback")
	vim.api.nvim_set_current_dir(test_root)
	vim.cmd.FTermDekit()
	assert(instances[#instances] ~= third, "cwd fallback switch replaces attachment")
	equal(third.closes[#third.closes].force, true, "fallback switch exits old attachment")
end, debug.traceback)

vim.api.nvim_set_current_dir(original_cwd)
vim.fn.delete(test_root, "rf")
if not ok then
	error(err)
end
print("dekit terminal tests passed")
vim.cmd.qa()
