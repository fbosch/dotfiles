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
		local instance = { opts = opts, opens = 0, closes = {} }
		function instance:open()
			self.opens = self.opens + 1
			self.win = vim.api.nvim_get_current_win()
		end
		function instance:close(force)
			table.insert(self.closes, { force = force })
			self.win = nil
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
	local expected = "cd "
		.. escaped
		.. " && direnv exec "
		.. escaped
		.. " dash -c "
		.. vim.fn.shellescape(native_command(project_a))
	equal(first.opts.cmd, expected, "direnv covers import and native UI with safe quoting")
	equal(first.opts.ft, "fterm_dekit", "terminal filetype")
	equal(first.opts.env.IN_NEOVIM, "1", "terminal environment")
	equal(first.opts.shell, "dash", "command shell")
	equal(first.opts.dimensions, { height = 0.85, width = 0.85 }, "terminal dimensions")
	equal(first.opens, 1, "native console opened directly")

	local count = #instances
	vim.cmd.FTermDekit()
	equal(#instances, count, "visible console closes without another client")
	equal(first.win, nil, "console window hidden")
	vim.cmd.FTermDekit()
	equal(#instances, count + 1, "reopening reimports the current script catalog")
	local refreshed = instances[#instances]
	equal(refreshed.opts.cmd, expected, "refresh attaches to the same project runner")
	equal(first.closes[#first.closes].force, true, "refresh exits only the old attachment")

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

	for _, name in ipairs({ "justfile", "Justfile", ".justfile" }) do
		vim.fn.writefile({ "test:", "\t@echo fixture" }, project_b .. "/" .. name)
		equal(project.resolve_dekit_command(project_b), native_command(project_b), name .. " uses shared import")
		vim.fn.delete(project_b .. "/" .. name)
	end

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
end, debug.traceback)

vim.api.nvim_set_current_dir(original_cwd)
vim.fn.delete(test_root, "rf")
if not ok then
	error(err)
end
print("native dekit import terminal tests passed")
vim.cmd.qa()
